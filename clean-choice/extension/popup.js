import { STORAGE_KEY, isDisabled, originOf, setDisabled } from "./site-settings.js";

const statusEl = document.getElementById("status");
const scanButton = document.getElementById("scan");
const results = document.getElementById("results");
const undoAll = document.getElementById("undo-all");
const siteToggle = document.getElementById("site-disabled");

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = originOf(tab?.url ?? "");

async function disabledOrigins() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? {};
}

async function call(method, ...args) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (name, params) => globalThis.__cleanChoice[name](...params),
    args: [method, args]
  });
  return injection?.result;
}

function render(report) {
  results.replaceChildren();
  const pairs = report?.pairs ?? [];
  const flagged = pairs.filter((p) => p.verdict === "flag");
  statusEl.textContent =
    pairs.length === 0
      ? "No upsell with a separate way to decline was found."
      : `${flagged.length} of ${pairs.length} upsell choice${pairs.length === 1 ? "" : "s"} look lopsided.`;
  for (const pair of pairs) {
    const item = document.createElement("li");
    const verdict = document.createElement("div");
    verdict.className = "verdict";
    verdict.textContent = pair.verdict === "flag" ? "Lopsided choice" : "Balanced choice (no change needed)";
    const names = document.createElement("div");
    const price = pair.offer.price ? ` (${pair.offer.price})` : "";
    names.textContent = `“${pair.offer.name}”${price} vs “${pair.decline.name}”`;
    item.append(verdict, names);
    if (pair.reasons.length) {
      const reasons = document.createElement("ul");
      for (const reason of pair.reasons) {
        const li = document.createElement("li");
        li.textContent = reason;
        reasons.append(li);
      }
      item.append(reasons);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const show = document.createElement("button");
    show.type = "button";
    show.textContent = "Show on page";
    show.addEventListener("click", () => call("preview", pair.id));
    actions.append(show);
    if (pair.verdict === "flag") {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = pair.applied ? "Undo" : "Show both equally";
      toggle.addEventListener("click", async () => {
        await call(pair.applied ? "undo" : "apply", pair.id);
        render(await call("state"));
      });
      actions.append(toggle);
    }
    item.append(actions);
    results.append(item);
  }
  undoAll.hidden = !pairs.some((p) => p.applied);
}

async function refreshSiteState() {
  const disabled = isDisabled(await disabledOrigins(), origin);
  siteToggle.checked = disabled;
  siteToggle.disabled = !origin;
  scanButton.disabled = disabled || !origin;
  if (!origin) statusEl.textContent = "Clean Choice cannot run on this page.";
  else if (disabled) statusEl.textContent = "Clean Choice is off for this site.";
}

scanButton.addEventListener("click", async () => {
  try {
    render(await call("scan"));
  } catch (error) {
    statusEl.textContent = `Could not scan this page: ${error.message}`;
  }
});

undoAll.addEventListener("click", async () => {
  await call("undo");
  render(await call("state"));
});

siteToggle.addEventListener("change", async () => {
  const disabled = siteToggle.checked;
  await chrome.storage.local.set({
    [STORAGE_KEY]: setDisabled(await disabledOrigins(), origin, disabled)
  });
  if (disabled) {
    await call("undo").catch(() => {});
    results.replaceChildren();
    undoAll.hidden = true;
  }
  await refreshSiteState();
});

await refreshSiteState();
