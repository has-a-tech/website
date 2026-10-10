// End-to-end tests for the verification API with fake GitHub, email and KV.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { checkSchoolEmail } from "../src/schools.js";

const SITE = "https://has-a.tech";

function makeEnv() {
  const store = new Map();
  return {
    SITE_URL: SITE,
    EMAIL_FROM: "has-a.tech <verify@has-a.tech>",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: "session-secret-for-tests",
    HMAC_SECRET: "hmac-secret-for-tests",
    RESEND_API_KEY: "resend-key",
    STATUS_API_KEY: "status-key",
    ASSETS: { fetch: () => new Response("static page") },
    VERIFY: {
      store,
      async get(k, type) {
        const v = store.get(k);
        if (v === undefined) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
    },
  };
}

// Fake upstream services.
let sentEmails = [];
let githubUser = { login: "Student-One", created_at: "2023-01-01T00:00:00Z" };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://github.com/login/oauth/access_token") {
    const body = JSON.parse(init.body);
    return Response.json(body.code === "good-code" ? { access_token: "gho_test" } : { error: "bad_verification_code" });
  }
  if (url === "https://api.github.com/user") return Response.json(githubUser);
  if (url === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(init.body));
    return Response.json({ id: "email_1" });
  }
  throw new Error("Unexpected fetch " + url);
};

const call = (env, path, { method = "GET", body, cookie, origin = SITE, auth } = {}) => {
  const headers = new Headers();
  if (body) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);
  if (auth) headers.set("Authorization", auth);
  headers.set("CF-Connecting-IP", "198.51.100.7");
  return worker.fetch(new Request(SITE + path, { method, headers, body: body && JSON.stringify(body) }), env);
};

const cookieValue = (res, name) => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(name + "=")) return c.split(";")[0];
  return null;
};

async function signIn(env) {
  const loginRes = await call(env, "/api/auth/login");
  assert.equal(loginRes.status, 302);
  const location = new URL(loginRes.headers.get("Location"));
  assert.equal(location.host, "github.com");
  assert.equal(location.searchParams.get("scope"), null, "asks for no extra permissions");
  const state = location.searchParams.get("state");
  const oauthCookie = cookieValue(loginRes, "hat_oauth");
  const cb = await call(env, `/api/auth/callback?code=good-code&state=${state}`, { cookie: oauthCookie });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get("Location"), SITE + "/verify");
  return cookieValue(cb, "hat_session");
}

test("school email rules", () => {
  assert.equal(checkSchoolEmail("a@mail.utoronto.ca").ok, true);
  assert.equal(checkSchoolEmail("a@stanford.edu").ok, true);
  assert.equal(checkSchoolEmail("a@ox.ac.uk").ok, true);
  assert.equal(checkSchoolEmail("a@unimelb.edu.au").ok, true);
  assert.equal(checkSchoolEmail("a@gmail.com").reason, "personal");
  assert.equal(checkSchoolEmail("a@notutoronto.ca").reason, "unknown", "suffix match needs a dot boundary");
  assert.equal(checkSchoolEmail("a@example.com").reason, "unknown");
  assert.equal(checkSchoolEmail("not-an-email").reason, "invalid");
});

test("full happy path: sign in, get code, confirm, bot sees verified", async () => {
  const env = makeEnv();
  sentEmails = [];
  githubUser = { login: "Student-One", created_at: "2023-01-01T00:00:00Z" };
  const session = await signIn(env);

  let me = await (await call(env, "/api/me", { cookie: session })).json();
  assert.equal(me.signedIn, true);
  assert.equal(me.login, "Student-One");
  assert.equal(me.verified, false);

  const start = await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "Student.One@Mail.UToronto.ca" } });
  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.match(startBody.sentTo, /^st•+@mail\.utoronto\.ca$/);
  assert.equal(sentEmails.length, 1);
  const code = sentEmails[0].text.match(/code is: (\d{6})/)[1];

  const wrong = await call(env, "/api/verify/confirm", { method: "POST", cookie: session, body: { code: code === "000000" ? "111111" : "000000" } });
  assert.equal(wrong.status, 400);

  const ok = await call(env, "/api/verify/confirm", { method: "POST", cookie: session, body: { code } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).schoolDomain, "utoronto.ca");

  me = await (await call(env, "/api/me", { cookie: session })).json();
  assert.equal(me.verified, true);

  // No plain email address is stored anywhere.
  for (const v of env.VERIFY.store.values()) assert.ok(!String(v).toLowerCase().includes("utoronto.ca/") && !String(v).toLowerCase().includes("student.one@"));

  // Registry bot lookup (case-insensitive username).
  const noAuth = await call(env, "/api/status/student-one");
  assert.equal(noAuth.status, 401);
  const st = await (await call(env, "/api/status/student-one", { auth: "Bearer status-key" })).json();
  assert.equal(st.verified, true);
  const other = await (await call(env, "/api/status/someone-else", { auth: "Bearer status-key" })).json();
  assert.equal(other.verified, false);
});

test("security checks", async () => {
  const env = makeEnv();
  sentEmails = [];
  githubUser = { login: "Student-Two", created_at: "2022-05-01T00:00:00Z" };

  // Callback with a forged state is rejected.
  const forged = await call(env, "/api/auth/callback?code=good-code&state=abc", { cookie: "hat_oauth=xyz" });
  assert.equal(forged.headers.get("Location"), SITE + "/verify?error=signin&reason=state-mismatch");
  const noCookie = await call(env, "/api/auth/callback?code=good-code&state=abc");
  assert.equal(noCookie.headers.get("Location"), SITE + "/verify?error=signin&reason=no-cookie");
  // A wrong client secret shows GitHub's reason.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes("access_token") ? Response.json({ error: "incorrect_client_credentials" }) : realFetch(u, i);
  const lr = await call(env, "/api/auth/login");
  const st = new URL(lr.headers.get("Location")).searchParams.get("state");
  const badCreds = await call(env, `/api/auth/callback?code=good-code&state=${st}`, { cookie: cookieValue(lr, "hat_oauth") });
  assert.equal(badCreds.headers.get("Location"), SITE + "/verify?error=signin&reason=github-incorrect_client_credentials");
  globalThis.fetch = realFetch;

  const session = await signIn(env);

  // Tampered session cookie is ignored.
  const tampered = session.replace(/\.[^.]+$/, ".AAAA");
  assert.equal((await (await call(env, "/api/me", { cookie: tampered })).json()).signedIn, false);

  // Requests from other websites are blocked.
  const cross = await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "a@yorku.ca" }, origin: "https://evil.example" });
  assert.equal(cross.status, 403);

  // Personal and unknown domains get clear messages and no email is sent.
  const gmail = await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "a@gmail.com" } });
  assert.equal((await gmail.json()).reason, "personal");
  assert.equal(sentEmails.length, 0);

  // Five wrong codes burn the pending code.
  await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "two@my.yorku.ca" } });
  const real = sentEmails.at(-1).text.match(/code is: (\d{6})/)[1];
  const bad = real === "123456" ? "654321" : "123456";
  let last;
  for (let i = 0; i < 5; i++) last = await call(env, "/api/verify/confirm", { method: "POST", cookie: session, body: { code: bad } });
  assert.equal(last.status, 429);
  const after = await call(env, "/api/verify/confirm", { method: "POST", cookie: session, body: { code: real } });
  assert.equal(after.status, 410, "correct code no longer works after lockout");

  // Rate limit: only 3 codes per hour per account (1 already used above).
  await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "two@my.yorku.ca" } });
  await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "two@my.yorku.ca" } });
  const limited = await call(env, "/api/verify/start", { method: "POST", cookie: session, body: { email: "two@my.yorku.ca" } });
  assert.equal(limited.status, 429);
});

test("one school email can't verify two GitHub accounts; delete-my-data works", async () => {
  const env = makeEnv();
  sentEmails = [];
  githubUser = { login: "first-user", created_at: "2022-01-01T00:00:00Z" };
  const s1 = await signIn(env);
  await call(env, "/api/verify/start", { method: "POST", cookie: s1, body: { email: "shared@uwaterloo.ca" } });
  const c1 = sentEmails.at(-1).text.match(/code is: (\d{6})/)[1];
  assert.equal((await call(env, "/api/verify/confirm", { method: "POST", cookie: s1, body: { code: c1 } })).status, 200);

  githubUser = { login: "second-user", created_at: "2022-01-01T00:00:00Z" };
  const s2 = await signIn(env);
  const dup = await call(env, "/api/verify/start", { method: "POST", cookie: s2, body: { email: "shared@uwaterloo.ca" } });
  assert.equal(dup.status, 409);

  // First user deletes their data; the email is freed and status is no longer verified.
  const del = await call(env, "/api/me/delete", { method: "POST", cookie: s1 });
  assert.equal(del.status, 200);
  const st = await (await call(env, "/api/status/first-user", { auth: "Bearer status-key" })).json();
  assert.equal(st.verified, false);
  assert.equal([...env.VERIFY.store.keys()].filter((k) => !k.startsWith("rl:")).length, 0);
});

test("www redirects to the main address so sign-in cookies work", async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request("https://www.has-a.tech/verify?x=1"), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://has-a.tech/verify?x=1");
  const apex = await worker.fetch(new Request("https://has-a.tech/verify"), env);
  assert.equal(await apex.text(), "static page");
});

test("new GitHub accounts are turned away at sign-in", async () => {
  const env = makeEnv();
  githubUser = { login: "brand-new", created_at: new Date().toISOString() };
  const loginRes = await call(env, "/api/auth/login");
  const state = new URL(loginRes.headers.get("Location")).searchParams.get("state");
  const cb = await call(env, `/api/auth/callback?code=good-code&state=${state}`, { cookie: cookieValue(loginRes, "hat_oauth") });
  assert.equal(cb.headers.get("Location"), SITE + "/verify?error=new-account");
  assert.equal(cookieValue(cb, "hat_session"), null);
});
