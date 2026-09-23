const $ = (id) => document.getElementById(id);
const LABELS = { save: "Bookmarked", obsidian: "Saved to Obsidian", close: "Closed", duplicate: "Duplicate" };

async function render() {
  const { status = {}, autoOrganize = true, apiKey, obsidianEnabled = false, cleaned = [], groupingGranularity = "balanced" } =
    await chrome.storage.local.get(["status", "autoOrganize", "apiKey", "obsidianEnabled", "cleaned", "groupingGranularity"]);
  $("autoOrganize").checked = autoOrganize;
  $("groupingGranularity").value = ["coarse", "balanced", "fine"].includes(groupingGranularity)
    ? groupingGranularity
    : "balanced";
  $("saveTab").hidden = !obsidianEnabled;
  $("digest").hidden = !obsidianEnabled;
  const busy = !!status.running;
  for (const id of ["organize", "saveTab", "digest", "regroup", "cleanup", "ungroup", "groupingGranularity"]) $(id).disabled = busy;

  const el = $("status");
  el.classList.toggle("error", !!status.lastError || !apiKey);
  if (!apiKey) el.textContent = "No API key set. Open Settings.";
  else if (busy) el.textContent = "Working…";
  else if (status.lastError) el.textContent = status.lastError;
  else if (status.lastRun) {
    const tokens = (status.inputTokens || 0) + (status.outputTokens || 0);
    el.textContent = `Last run ${new Date(status.lastRun).toLocaleTimeString()} · placed ${status.lastPlaced || 0} tabs · ${tokens.toLocaleString()} tokens total`;
  } else el.textContent = "Not run yet.";

  $("cleanedCount").textContent = cleaned.length;
  $("cleaned").replaceChildren(
    ...cleaned.slice(0, 30).map((entry, index) => {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `${LABELS[entry.action] || entry.action} · ${entry.reason}`;
      const link = document.createElement("a");
      link.href = "#";
      link.title = entry.note ? `${entry.note}\nClick to reopen ${entry.url}` : `Reopen ${entry.url}`;
      link.textContent = entry.title || entry.url;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "restore", index });
      });
      li.append(tag, link);
      return li;
    })
  );
}

$("autoOrganize").addEventListener("change", (e) => chrome.storage.local.set({ autoOrganize: e.target.checked }));
$("groupingGranularity").addEventListener("change", (e) => chrome.storage.local.set({ groupingGranularity: e.target.value }));
$("organize").addEventListener("click", () => chrome.runtime.sendMessage({ type: "organize" }));
async function runAction(buttonId, working, message) {
  $(buttonId).disabled = true;
  $("status").classList.remove("error");
  $("status").textContent = working;
  const result = await chrome.runtime.sendMessage(message);
  $(buttonId).disabled = false;
  $("status").classList.toggle("error", !result.ok);
  $("status").textContent = result.message;
}

$("saveTab").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  runAction("saveTab", "Writing note…", { type: "saveTab", tabId: tab.id });
});
$("digest").addEventListener("click", () => runAction("digest", "Writing digest…", { type: "writeDigest" }));
$("regroup").addEventListener("click", () => chrome.runtime.sendMessage({ type: "organize", full: true }));
$("cleanup").addEventListener("click", () => chrome.runtime.sendMessage({ type: "organize", cleanup: true }));
$("ungroup").addEventListener("click", () => chrome.runtime.sendMessage({ type: "ungroupAll" }));
$("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener(render);
render();
