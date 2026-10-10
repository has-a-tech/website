// Small helpers shared by the API. Uses only Web Crypto, no dependencies.

const enc = new TextEncoder();

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function error(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

export function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmac(secret, message) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message));
  return b64url(sig);
}

// Compares two strings in constant time (for secrets and signatures).
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomCode() {
  // 6 digits, uniformly distributed.
  const max = 4294967296 - (4294967296 % 1000000);
  let n;
  do n = crypto.getRandomValues(new Uint32Array(1))[0];
  while (n >= max);
  return String(n % 1000000).padStart(6, "0");
}

// ---------- cookies ----------

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function setCookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

// ---------- signed session ----------

const SESSION_COOKIE = "hat_session";
const SESSION_SECONDS = 60 * 60; // 1 hour

export async function createSession(env, login) {
  const payload = b64url(enc.encode(JSON.stringify({ login, exp: Date.now() + SESSION_SECONDS * 1000 })));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return setCookie(SESSION_COOKIE, `${payload}.${sig}`, SESSION_SECONDS);
}

export function clearSession() {
  return setCookie(SESSION_COOKIE, "", 0);
}

export async function readSession(request, env) {
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw || !raw.includes(".")) return null;
  const [payload, sig] = raw.split(".");
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (typeof data.login !== "string" || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- rate limiting (approximate, KV-based) ----------

export async function rateLimit(env, key, limit, windowSeconds = 3600) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const k = `rl:${key}:${bucket}`;
  const n = parseInt((await env.VERIFY.get(k)) || "0", 10);
  if (n >= limit) return false;
  await env.VERIFY.put(k, String(n + 1), { expirationTtl: Math.max(60, windowSeconds + 60) });
  return true;
}

// Only accept state-changing requests from our own site.
export function sameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return origin === new URL(env.SITE_URL).origin;
}

export const GITHUB_USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
