const $ = (id) => document.getElementById(id);
let tab;
let settings;

const obsidianUri = (path) =>
  `obsidian://open?vault=${encodeURIComponent(settings.vaultName)}&file=${encodeURIComponent(path.replace(/\.md$/, ""))}`;

function noteItem(n, meta) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = n.name || n.path.split("/").pop().replace(/\.md$/, "");
  const m = document.createElement("span");
  m.className = "meta";
  m.textContent = meta;
  li.append(name, m);
  if (n.context) {
    const c = document.createElement("span");
    c.className = "ctx";
    c.textContent = n.context.replace(/\s+/g, " ");
    li.append(c);
  }
  li.title = `Open ${n.path} in Obsidian`;
  li.addEventListener("click", () => chrome.tabs.create({ url: obsidianUri(n.path) }));
  return li;
}

function renderRelated(result) {
  const notes = result.notes || [];
  $("notes").replaceChildren(...notes.map((n) => noteItem(n, `${n.path.split("/").slice(0, -1).join("/")} · ${n.reason}`)));
  if (result.error) return setStatus(`Obsidian: ${result.error}`, "error");
  if (!result.configured) return setStatus("Set your Obsidian API key in Settings.", "error");
  if (result.saved) setStatus("This page is already cited in your vault.", "ok");
  else if (notes.length) setStatus(`${notes.length} related note${notes.length > 1 ? "s" : ""}${result.claude ? " (incl. Claude picks)" : ""}.`);
  else setStatus("No related notes found.");
}

function setStatus(text, cls = "muted") {
  $("status").className = cls;
  $("status").textContent = text;
}

async function renderClips() {
  const { clips = [] } = await chrome.storage.local.get("clips");
  $("clips").replaceChildren(
    ...clips.slice(0, 15).map((c) => noteItem({ path: c.path }, `${c.kind} from ${c.title || c.url} · ${new Date(c.at).toLocaleDateString("en-CA")}`))
  );
}

async function load(force = false) {
  setStatus("Looking up related notes…");
  const result = await chrome.runtime.sendMessage({ type: "related", tabId: tab.id, force });
  if (!result.ok) return setStatus(result.message, "error");
  renderRelated(result);
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  ({ settings } = await chrome.runtime.sendMessage({ type: "settings" }));
  $("matchClaude").hidden = !settings.apiKey;
  await load();
  renderClips();
}

$("refresh").addEventListener("click", () => load(true));
$("matchClaude").addEventListener("click", async () => {
  $("matchClaude").disabled = true;
  setStatus("Asking Claude…");
  const result = await chrome.runtime.sendMessage({ type: "matchClaude", tabId: tab.id });
  $("matchClaude").disabled = false;
  if (!result.ok) return setStatus(result.message, "error");
  renderRelated({ ...result, configured: true });
});

for (const [id, kind] of [["clipSelection", "selection"], ["clipTable", "table"], ["clipLink", "link"]]) {
  $(id).addEventListener("click", async () => {
    const result = await chrome.runtime.sendMessage({ type: "clip", tabId: tab.id, kind });
    if (!result.ok) setStatus(result.message, "error");
    else window.close();
  });
}
$("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
