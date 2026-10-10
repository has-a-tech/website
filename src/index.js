// has-a.tech: website + student verification API, running on Cloudflare Workers.
//
// Static pages come from ./public (served automatically). This Worker handles /api/*.
//
// KV keys (namespace binding VERIFY):
//   pending:<login>    a code waiting to be confirmed (expires after 15 minutes)
//   verified:<login>   { verifiedAt, method, schoolDomain }  (no email address is stored)
//   email:<hash>       which GitHub login a school email is linked to (keyed by a keyed hash, not the email)
//   rl:...             rate-limit counters

import {
  json, error, hmac, safeEqual, randomToken, randomCode, getCookie, setCookie,
  createSession, clearSession, readSession, rateLimit, sameOrigin, GITHUB_USER_RE,
} from "./util.js";
import { checkSchoolEmail, normalizeEmail } from "./schools.js";

const CODE_TTL = 15 * 60;
const MAX_ATTEMPTS = 5;
const MIN_ACCOUNT_AGE_DAYS = 30;
const OAUTH_COOKIE = "hat_oauth";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // One canonical address. Sign-in cookies only work on a single hostname,
    // so www.has-a.tech (and any other alias) redirects to has-a.tech.
    const canonical = new URL(env.SITE_URL);
    if (url.hostname !== canonical.hostname && !url.hostname.endsWith(".workers.dev") && url.hostname !== "localhost") {
      return Response.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return error("Something went wrong on our side. Please try again in a minute.", 500);
    }
  },
};

async function route(request, env, url) {
  const p = url.pathname;
  const m = request.method;
  if (p === "/api/auth/login" && m === "GET") return login(env);
  if (p === "/api/auth/callback" && m === "GET") return callback(request, env, url);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env);
  if (p === "/api/me" && m === "GET") return me(request, env);
  if (p === "/api/me/delete" && m === "POST") return deleteMe(request, env);
  if (p === "/api/verify/start" && m === "POST") return start(request, env);
  if (p === "/api/verify/confirm" && m === "POST") return confirm(request, env);
  if (p.startsWith("/api/status/") && m === "GET") return status(request, env, p.slice("/api/status/".length));
  return error("Not found.", 404);
}

// ---------- GitHub sign-in ----------

function login(env) {
  const state = randomToken(16);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.SITE_URL}/api/auth/callback`,
    state,
    allow_signup: "true",
  }); // no scope: we only read the public profile
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params}`,
      "Set-Cookie": setCookie(OAUTH_COOKIE, state, 600),
      "Cache-Control": "no-store",
    },
  });
}

function redirect(env, path, cookies = []) {
  const headers = new Headers({ Location: `${env.SITE_URL}${path}`, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

async function callback(request, env, url) {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expected = getCookie(request, OAUTH_COOKIE);
  const clearState = setCookie(OAUTH_COOKIE, "", 0);
  // Reason codes are shown to the person so problems can be diagnosed. They never contain secrets.
  const fail = (reason, detail = "") => {
    console.error(`sign-in failed: ${reason} ${detail}`);
    return redirect(env, `/verify?error=signin&reason=${reason}`, [clearState]);
  };
  if (url.searchParams.get("error")) return fail("denied", url.searchParams.get("error")); // user clicked Cancel
  if (!code || !state) return fail("missing-code");
  if (!expected) return fail("no-cookie"); // started on a different address, or cookies blocked
  if (!safeEqual(state, expected)) return fail("state-mismatch");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.SITE_URL}/api/auth/callback`,
    }),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  const token = tokenBody.access_token;
  if (!token) {
    // GitHub explains why, e.g. "incorrect_client_credentials" or "redirect_uri_mismatch".
    const why = String(tokenBody.error || `http-${tokenRes.status}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    return fail(`github-${why}`);
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "has-a.tech", Accept: "application/vnd.github+json" },
  });
  if (!userRes.ok) return fail("profile", String(userRes.status));
  const user = await userRes.json();
  // The token is not stored anywhere; we only needed it to learn who signed in.

  const ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
  if (!(ageDays >= MIN_ACCOUNT_AGE_DAYS)) {
    return redirect(env, "/verify?error=new-account", [clearState]);
  }
  return redirect(env, "/verify", [clearState, await createSession(env, user.login)]);
}

async function logout(request, env) {
  if (!sameOrigin(request, env)) return error("Request blocked.", 403);
  return json({ ok: true }, 200, { "Set-Cookie": clearSession() });
}

// ---------- current user ----------

async function me(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ ok: true, signedIn: false });
  const record = await env.VERIFY.get(`verified:${session.login.toLowerCase()}`, "json");
  const pending = await env.VERIFY.get(`pending:${session.login.toLowerCase()}`, "json");
  return json({
    ok: true,
    signedIn: true,
    login: session.login,
    verified: Boolean(record),
    schoolDomain: record?.schoolDomain || null,
    verifiedAt: record?.verifiedAt || null,
    codePending: Boolean(pending),
  });
}

async function deleteMe(request, env) {
  if (!sameOrigin(request, env)) return error("Request blocked.", 403);
  const session = await readSession(request, env);
  if (!session) return error("Sign in with GitHub first.", 401);
  const key = session.login.toLowerCase();
  const record = await env.VERIFY.get(`verified:${key}`, "json");
  if (record?.emailHash) await env.VERIFY.delete(`email:${record.emailHash}`);
  await env.VERIFY.delete(`verified:${key}`);
  await env.VERIFY.delete(`pending:${key}`);
  return json({ ok: true }, 200, { "Set-Cookie": clearSession() });
}

// ---------- verification ----------

async function readBody(request) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) return null;
  const text = await request.text();
  if (text.length > 2000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function maskEmail(email) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

async function start(request, env) {
  if (!sameOrigin(request, env)) return error("Request blocked.", 403);
  const session = await readSession(request, env);
  if (!session) return error("Your sign-in expired. Sign in with GitHub again.", 401);
  const login = session.login.toLowerCase();

  if (await env.VERIFY.get(`verified:${login}`)) return json({ ok: true, alreadyVerified: true });

  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  const check = checkSchoolEmail(email);
  if (!check.ok) {
    const messages = {
      invalid: "That doesn't look like an email address. Check it and try again.",
      personal: "Use the email address your school gave you, not a personal one like Gmail.",
      unknown: `We don't recognize ${check.domain} as a school yet. Ask us to add it, or verify by email instead (see below).`,
    };
    return json({ ok: false, error: messages[check.reason], reason: check.reason }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hmac(env.HMAC_SECRET, `ip:${ip}`); // never store raw IP addresses
  const emailHash = await hmac(env.HMAC_SECRET, `email:${email}`);
  if (!(await rateLimit(env, `ip:${ipHash}`, 10)) ||
      !(await rateLimit(env, `start:${login}`, 3)) ||
      !(await rateLimit(env, `mail:${emailHash}`, 3))) {
    return error("Too many codes requested. Wait an hour, then try again.", 429);
  }

  const linked = await env.VERIFY.get(`email:${emailHash}`);
  if (linked && linked !== login) {
    return error("This school email is already linked to another GitHub account. If that's a mistake, email us.", 409);
  }

  const code = randomCode();
  const codeHash = await hmac(env.HMAC_SECRET, `code:${login}:${code}`);
  await env.VERIFY.put(
    `pending:${login}`,
    JSON.stringify({ emailHash, domain: check.domain, codeHash, attempts: 0, expiresAt: Date.now() + CODE_TTL * 1000 }),
    { expirationTtl: CODE_TTL }
  );

  const sent = await sendCode(env, email, code, session.login);
  if (!sent) {
    await env.VERIFY.delete(`pending:${login}`);
    return error("We couldn't send the email. Check the address, or try again in a few minutes.", 502);
  }
  return json({ ok: true, sentTo: maskEmail(email) });
}

async function confirm(request, env) {
  if (!sameOrigin(request, env)) return error("Request blocked.", 403);
  const session = await readSession(request, env);
  if (!session) return error("Your sign-in expired. Sign in with GitHub again.", 401);
  const login = session.login.toLowerCase();

  const body = await readBody(request);
  const code = String(body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return error("Enter the 6-digit code from the email.");

  const pending = await env.VERIFY.get(`pending:${login}`, "json");
  if (!pending) return error("That code has expired. Send a new one.", 410);

  const ok = safeEqual(await hmac(env.HMAC_SECRET, `code:${login}:${code}`), pending.codeHash);
  if (!ok) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_ATTEMPTS) {
      await env.VERIFY.delete(`pending:${login}`);
      return error("Too many wrong codes. Send a new one.", 429);
    }
    const ttl = Math.max(60, Math.floor((pending.expiresAt - Date.now()) / 1000));
    await env.VERIFY.put(`pending:${login}`, JSON.stringify(pending), { expirationTtl: ttl });
    return error(`That code isn't right. ${MAX_ATTEMPTS - pending.attempts} tries left.`);
  }

  const linked = await env.VERIFY.get(`email:${pending.emailHash}`);
  if (linked && linked !== login) {
    await env.VERIFY.delete(`pending:${login}`);
    return error("This school email is already linked to another GitHub account.", 409);
  }

  const record = {
    verifiedAt: new Date().toISOString(),
    method: "school-email",
    schoolDomain: pending.domain,
    emailHash: pending.emailHash,
  };
  await env.VERIFY.put(`email:${pending.emailHash}`, login);
  await env.VERIFY.put(`verified:${login}`, JSON.stringify(record));
  await env.VERIFY.delete(`pending:${login}`);
  return json({ ok: true, verified: true, schoolDomain: pending.domain });
}

// ---------- status lookup for the registry bot ----------

async function status(request, env, rawLogin) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.STATUS_API_KEY || !safeEqual(auth, `Bearer ${env.STATUS_API_KEY}`)) {
    return error("Unauthorized.", 401);
  }
  const login = decodeURIComponent(rawLogin);
  if (!GITHUB_USER_RE.test(login)) return error("Invalid username.");
  const record = await env.VERIFY.get(`verified:${login.toLowerCase()}`, "json");
  return json({
    ok: true,
    login,
    verified: Boolean(record),
    method: record?.method || null,
    verifiedAt: record?.verifiedAt || null,
  });
}

// ---------- email ----------

async function sendCode(env, to, code, login) {
  if (env.EMAIL_DEV_LOG === "true" && env.SITE_URL.startsWith("http://localhost")) {
    console.log(`[dev] verification code for ${login} <${to}>: ${code}`);
    return true;
  }
  const text =
    `Hi ${login},\n\nYour has-a.tech verification code is: ${code}\n\n` +
    `It expires in 15 minutes. Enter it on the page where you requested it.\n\n` +
    `If you didn't ask for this, you can ignore this email. Nobody can use the code without your GitHub account.\n\n` +
    `has-a.tech`;
  const html =
    `<p>Hi ${escapeHtml(login)},</p><p>Your has-a.tech verification code is:</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>` +
    `<p>It expires in 15 minutes. Enter it on the page where you requested it.</p>` +
    `<p style="color:#555">If you didn't ask for this, you can ignore this email. Nobody can use the code without your GitHub account.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: `Your has-a.tech code: ${code}`, text, html }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text().catch(() => ""));
  return res.ok;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
