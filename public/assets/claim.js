import { checkName, debounce, REPO } from "./names.js";

const $ = (id) => document.getElementById(id);
const els = {
  name: $("name"), nameStatus: $("name-status"), username: $("username"), host: $("host"),
  target: $("target"), targetLabel: $("target-label"), targetHint: $("target-hint"), targetField: $("target-field"),
  description: $("description"), preview: $("preview"), filePath: $("file-path"),
  create: $("create"), copy: $("copy"), problem: $("form-problem"),
  forkStatus: $("fork-status"), forkRecheck: $("fork-recheck"), pr: $("pr"),
};
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const HOSTS = {
  github: { fixed: (u) => (u ? `${u.toLowerCase()}.github.io` : ""), hint: "Filled in from your GitHub username." },
  azure: { label: "Your Azure address", placeholder: "calm-ocean-123.azurestaticapps.net", hint: "Shown on your Static Web App's Overview page, without https://." },
  vercel: { fixed: () => "cname.vercel-dns.com", hint: "The same for every Vercel site." },
  netlify: { label: "Your Netlify address", placeholder: "your-site.netlify.app", hint: "Without https://." },
  cloudflare: { label: "Your Pages address", placeholder: "your-project.pages.dev", hint: "Without https://." },
  server: { label: "Your server's public IP address", placeholder: "203.0.113.10", hint: "An IPv4 address. Private addresses like 192.168.x.x won't work." },
  other: { label: "Your site's hostname", placeholder: "example.com", hint: "Just the hostname, without https:// or a path." },
};

let nameOk = false;
// state: "none" (no username yet) | "checking" | "found" | "missing" | "unknown"
let fork = { state: "none" };

// GitHub's own "Fork this repository" button on the new-file page fails for
// many people, so the file is created in their fork instead. This finds it.
async function findFork(username) {
  const gh = (path) => fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json" } });
  try {
    const res = await gh(`/repos/${username}/register`);
    if (res.status === 404) return { state: "missing" };
    if (!res.ok) return { state: "unknown" };
    const repo = await res.json();
    if (repo.source?.full_name === REPO) return { state: "found", name: repo.name, branch: repo.default_branch };
    // They already had a repo called "register", so their fork got another name.
    const forks = await gh(`/repos/${REPO}/forks?per_page=100&sort=newest`);
    if (!forks.ok) return { state: "unknown" };
    const match = (await forks.json()).find((f) => f.owner.login.toLowerCase() === username.toLowerCase());
    return match ? { state: "found", name: match.name, branch: match.default_branch } : { state: "missing" };
  } catch {
    return { state: "unknown" };
  }
}

async function checkFork() {
  const u = els.username.value.trim();
  if (!USERNAME_RE.test(u)) { fork = { state: "none" }; render(); return; }
  fork = { state: "checking" };
  render();
  const result = await findFork(u);
  if (els.username.value.trim() !== u) return;
  fork = result;
  render();
}
const checkForkSoon = debounce(checkFork, 600);

const FORK_STATUS = {
  none: ["", "Enter your GitHub username above and we'll check for your fork."],
  checking: ["muted", "Looking for your fork…"],
  found: ["ok", "Found your fork. Go on to step 2."],
  missing: ["bad", "We can't find your fork yet. Fork the register, then click Check again."],
  unknown: ["muted", "Couldn't check right now. If you've already forked the register, go on to step 2."],
};

function records() {
  const host = HOSTS[els.host.value];
  const value = (host.fixed ? host.fixed(els.username.value.trim()) : els.target.value.trim())
    .replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return els.host.value === "server" ? { A: [value] } : { CNAME: value };
}

function problems() {
  const out = [];
  const u = els.username.value.trim();
  if (!nameOk) out.push("Choose an available name.");
  if (!USERNAME_RE.test(u)) out.push("Enter your GitHub username.");
  const r = records();
  const v = r.A ? r.A[0] : r.CNAME;
  if (!v) out.push("Enter your site's address.");
  else if (r.A && !/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) out.push("That doesn't look like an IPv4 address.");
  else if (r.CNAME && !/^([a-z0-9_-]+\.)+[a-z]{2,}$/i.test(v)) out.push("That doesn't look like a hostname.");
  const d = els.description.value.trim();
  if (d.length < 10) out.push("Describe your site in at least 10 characters.");
  return out;
}

function fileText() {
  return JSON.stringify(
    { description: els.description.value.trim(), owner: { username: els.username.value.trim() }, records: records() },
    null, 2
  ) + "\n";
}

function render() {
  const host = HOSTS[els.host.value];
  els.target.readOnly = Boolean(host.fixed);
  if (host.fixed) {
    els.target.value = host.fixed(els.username.value.trim());
    els.targetLabel.textContent = "Your site's address";
  } else {
    els.targetLabel.textContent = host.label;
    els.target.placeholder = host.placeholder;
  }
  els.targetHint.textContent = host.hint;

  const name = els.name.value || "yourname";
  els.filePath.textContent = `domains/${name}.json`;
  const text = fileText();
  els.preview.textContent = text;

  const [cls, msg] = FORK_STATUS[fork.state];
  els.forkStatus.textContent = msg;
  els.forkStatus.className = `status ${cls}`;

  const list = problems();
  els.problem.textContent = list[0] || "";
  const u = els.username.value.trim();
  // If GitHub couldn't be asked, guess the usual fork name rather than block people.
  const ready = list.length === 0 && (fork.state === "found" || fork.state === "unknown");
  if (ready) {
    const repo = fork.name || "register";
    const branch = fork.branch || "main";
    const params = new URLSearchParams({ filename: `${els.name.value}.json`, value: text });
    setLink(els.create, `https://github.com/${u}/${repo}/new/${branch}/domains?${params}`);
    setLink(els.pr, `https://github.com/${REPO}/compare/main...${u}:${repo}:${branch}?expand=1`);
  } else {
    setLink(els.create, null);
    setLink(els.pr, null);
  }
}

function setLink(el, href) {
  el.href = href || "#";
  if (href) el.removeAttribute("aria-disabled");
  else el.setAttribute("aria-disabled", "true");
}

// Why a step's button is greyed out.
function blocker() {
  if (fork.state === "missing") return "Fork the register first (step 1).";
  if (fork.state === "checking") return "Still looking for your fork. Try again in a moment.";
  return problems()[0] || "";
}

const check = debounce(async () => {
  const name = els.name.value;
  nameOk = false;
  render();
  if (!name) { els.nameStatus.textContent = ""; return; }
  els.nameStatus.textContent = "Checking…";
  els.nameStatus.className = "status muted";
  const result = await checkName(name);
  if (els.name.value !== name) return;
  nameOk = result.state === "ok";
  els.nameStatus.textContent = result.message;
  els.nameStatus.className = `status ${result.state}`;
  render();
}, 450);

els.name.addEventListener("input", () => {
  els.name.value = els.name.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  check();
});
for (const el of [els.username, els.host, els.target, els.description]) {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
}
els.username.addEventListener("input", checkForkSoon);
els.forkRecheck.addEventListener("click", checkFork);
// People fork in another tab, so look again when they come back.
window.addEventListener("focus", () => {
  if (fork.state === "missing" || fork.state === "unknown") checkFork();
});
for (const el of [els.create, els.pr]) {
  el.addEventListener("click", (e) => {
    if (el.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      els.problem.textContent = blocker();
      els.problem.focus?.();
    }
  });
}
els.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(fileText());
    els.copy.textContent = "Copied";
    setTimeout(() => (els.copy.textContent = "Copy"), 1500);
  } catch {
    els.copy.textContent = "Select the text and copy it";
  }
});

// Prefill from the URL and from the signed-in GitHub account.
const params = new URLSearchParams(location.search);
if (params.get("name")) {
  els.name.value = params.get("name").toLowerCase().replace(/[^a-z0-9-]/g, "");
  check();
}
render();

fetch("/api/me", { credentials: "same-origin" })
  .then((r) => r.json())
  .then((me) => {
    if (!me.signedIn) { $("verify-reminder").hidden = false; return; }
    if (!els.username.value) { els.username.value = me.login; checkFork(); }
    if (me.verified) {
      $("verified-note").hidden = false;
      $("verified-text").textContent = `Signed in as ${me.login}, verified student.`;
    } else {
      $("verify-reminder").hidden = false;
    }
    render();
  })
  .catch(() => {});
