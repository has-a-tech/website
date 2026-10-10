const $ = (id) => document.getElementById(id);
const steps = ["step-signin", "step-email", "step-code", "step-done"];

function show(step) {
  $("loading").hidden = true;
  for (const s of steps) $(s).hidden = s !== step;
  const focusable = $(step).querySelector("input, .button");
  if (step !== "step-signin") focusable?.focus();
}

function setStatus(id, text, kind = "bad") {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${text ? kind : ""}`;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Unexpected response. Try again." }));
  return { status: res.status, ...data };
}

const ERRORS = {
  signin: "Sign-in with GitHub didn't finish. Please try again.",
  "new-account": "Your GitHub account needs to be at least 30 days old. Come back once it is.",
};
// Extra detail for sign-in problems. The code helps whoever runs the site fix it.
const REASONS = {
  denied: "You cancelled on GitHub. Click Sign in with GitHub to try again.",
  "no-cookie": "Your browser didn't keep the sign-in cookie. Open has-a.tech/verify (without www), make sure cookies are allowed, and try again.",
  "state-mismatch": "The sign-in link was out of date. Try again from this page.",
  "github-bad_verification_code": "The sign-in link expired. Try again.",
  "github-incorrect_client_credentials": "The site's GitHub connection isn't set up correctly (Client ID or secret). If you run has-a.tech, check SETUP.md step 3.",
  "github-redirect_uri_mismatch": "The site's GitHub app has the wrong callback URL. If you run has-a.tech, it must be https://has-a.tech/api/auth/callback.",
};
const params = new URLSearchParams(location.search);
const err = params.get("error");
if (ERRORS[err]) {
  const reason = params.get("reason");
  let text = ERRORS[err];
  if (reason) text += ` ${REASONS[reason] || ""} (code: ${reason})`;
  $("page-error").hidden = false;
  $("page-error-text").textContent = text.replace(/\s+/g, " ").trim();
  history.replaceState(null, "", "/verify");
}

async function load() {
  const me = await api("/api/me").catch(() => null);
  if (!me?.ok) {
    $("loading").textContent = "Couldn't reach the server. Refresh the page to try again.";
    return;
  }
  if (!me.signedIn) return show("step-signin");
  for (const el of document.querySelectorAll(".who")) el.textContent = me.login;
  if (me.verified) {
    $("school").textContent = me.schoolDomain || "your school";
    return show("step-done");
  }
  show("step-email");
}

$("step-email").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  if (!email) return setStatus("email-status", "Enter your school email address.");
  const button = e.submitter;
  button.disabled = true;
  setStatus("email-status", "Sending…", "muted");
  const r = await api("/api/verify/start", { email });
  button.disabled = false;
  if (r.status === 401) return show("step-signin");
  if (r.alreadyVerified) return load();
  if (!r.ok) return setStatus("email-status", r.error);
  setStatus("email-status", "");
  $("sent-to").textContent = r.sentTo;
  $("code").value = "";
  setStatus("code-status", "");
  show("step-code");
});

$("step-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("code").value.trim();
  if (!/^\d{6}$/.test(code)) return setStatus("code-status", "Enter the 6-digit code from the email.");
  const button = e.submitter;
  button.disabled = true;
  setStatus("code-status", "Checking…", "muted");
  const r = await api("/api/verify/confirm", { code });
  button.disabled = false;
  if (r.status === 401) return show("step-signin");
  if (!r.ok) {
    setStatus("code-status", r.error);
    if (r.status === 410 || r.status === 429) setTimeout(() => show("step-email"), 1800);
    return;
  }
  $("school").textContent = r.schoolDomain;
  show("step-done");
});

$("code").addEventListener("input", () => {
  $("code").value = $("code").value.replace(/\D/g, "").slice(0, 6);
});
$("resend").addEventListener("click", () => show("step-email"));

for (const b of document.querySelectorAll(".signout")) {
  b.addEventListener("click", async () => {
    await api("/api/auth/logout", {});
    show("step-signin");
  });
}

$("delete").addEventListener("click", async () => {
  if (!confirm("Delete your verification? You'll need to verify again to register a new name.")) return;
  const r = await api("/api/me/delete", {});
  if (r.ok) show("step-signin");
});

load();
