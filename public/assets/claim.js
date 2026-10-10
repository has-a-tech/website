import { checkName, debounce, REPO } from "./names.js";

const $ = (id) => document.getElementById(id);
const els = {
  name: $("name"), nameStatus: $("name-status"), username: $("username"), host: $("host"),
  target: $("target"), targetLabel: $("target-label"), targetHint: $("target-hint"), targetField: $("target-field"),
  description: $("description"), preview: $("preview"), filePath: $("file-path"),
  create: $("create"), copy: $("copy"), problem: $("form-problem"),
};

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
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(u)) out.push("Enter your GitHub username.");
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

  const list = problems();
  els.problem.textContent = list[0] || "";
  if (list.length === 0) {
    const params = new URLSearchParams({ filename: `${els.name.value}.json`, value: text });
    els.create.href = `https://github.com/${REPO}/new/main/domains?${params}`;
    els.create.removeAttribute("aria-disabled");
  } else {
    els.create.href = "#";
    els.create.setAttribute("aria-disabled", "true");
  }
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
els.create.addEventListener("click", (e) => {
  if (els.create.getAttribute("aria-disabled") === "true") {
    e.preventDefault();
    els.problem.textContent = problems()[0] || "";
    els.problem.focus?.();
  }
});
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
    if (!els.username.value) els.username.value = me.login;
    if (me.verified) {
      $("verified-note").hidden = false;
      $("verified-text").textContent = `Signed in as ${me.login}, verified student.`;
    } else {
      $("verify-reminder").hidden = false;
    }
    render();
  })
  .catch(() => {});
