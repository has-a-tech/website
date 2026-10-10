import { checkName, debounce } from "./names.js";

const input = document.getElementById("name");
const status = document.getElementById("name-status");
const claim = document.getElementById("claim-link");

function size() {
  input.style.width = `${Math.max(3, input.value.length || input.placeholder.length) + 0.5}ch`;
}

const run = debounce(async () => {
  const name = input.value;
  if (!name) {
    status.textContent = "";
    status.className = "status";
    claim.href = "/claim";
    return;
  }
  status.textContent = "Checking…";
  status.className = "status muted";
  const result = await checkName(name);
  if (input.value !== name) return; // the user kept typing
  status.textContent = result.message;
  status.className = `status ${result.state}`;
  claim.href = result.state === "ok" ? `/claim?name=${encodeURIComponent(name)}` : "/claim";
}, 450);

input.addEventListener("input", () => {
  input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  size();
  run();
});
size();
