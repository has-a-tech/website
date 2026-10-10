// Checks whether a has-a.tech name is valid and free.
// The rules mirror scripts/lib.js in the register repo, and the lists are
// loaded live from that repo so there's one source of truth.

export const REPO = "has-a-tech/register";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

let listsPromise;
function loadLists() {
  listsPromise ??= Promise.all([
    fetch(`${RAW}/util/reserved.json`).then((r) => r.json()),
    fetch(`${RAW}/util/blocked-words.json`).then((r) => r.json()),
    fetch(`${RAW}/util/config.json`).then((r) => r.json()),
  ])
    .then(([reserved, blocked, config]) => ({ reserved: new Set(reserved), blocked, config }))
    .catch(() => ({ reserved: new Set(), blocked: { substrings: [], words: [] }, config: { minNameLength: 2 } }));
  return listsPromise;
}

// Returns null if the format is fine, or a message saying what to fix.
export async function formatProblem(name) {
  const { reserved, blocked, config } = await loadLists();
  if (!name) return "Type a name to check it.";
  if (name.length > 63) return "Names can be at most 63 characters.";
  if (!LABEL_RE.test(name)) return "Use lowercase letters, numbers and hyphens. No hyphen at the start or end.";
  if (name.length < config.minNameLength) return `Names need at least ${config.minNameLength} characters.`;
  if (reserved.has(name)) return "That name is reserved for the service.";
  for (const s of blocked.substrings) if (name.includes(s)) return `Names can't include "${s}".`;
  for (const part of name.split("-")) if (blocked.words.includes(part)) return `Names can't include the word "${part}".`;
  return null;
}

// "free" | "taken" | "unknown"
export async function availability(name) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/domains/${encodeURIComponent(name)}.json`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return "free";
    if (res.ok) return "taken";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function checkName(name) {
  const problem = await formatProblem(name);
  if (problem) return { state: "bad", message: problem };
  const a = await availability(name);
  if (a === "free") return { state: "ok", message: `${name}.has-a.tech is available.` };
  if (a === "taken") return { state: "bad", message: `${name}.has-a.tech is already taken.` };
  return { state: "muted", message: "Couldn't check right now. GitHub limits how often we can ask; try again in a few minutes." };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
