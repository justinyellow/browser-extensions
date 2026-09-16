const $ = (id) => document.getElementById(id);
const LABEL = { selection: "Append selection", table: "Append table", link: "Save link" };
let notes = [];
let clip;
let busy = false;

const setStatus = (text, cls = "muted") => {
  $("status").className = cls;
  $("status").textContent = text;
};

async function choose(path, newNoteTitle) {
  if (busy) return;
  busy = true;
  setStatus(newNoteTitle ? `Creating ${newNoteTitle}…` : `Appending to ${path}…`);
  const result = await chrome.runtime.sendMessage({ type: "commitClip", path, newNoteTitle });
  if (!result.ok) {
    busy = false;
    return setStatus(result.message, "error");
  }
  setStatus(`Added to ${result.path}`, "ok");
  setTimeout(() => window.close(), 900);
}

function item(path, meta) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = path.split("/").pop().replace(/\.md$/, "");
  const m = document.createElement("span");
  m.className = "meta";
  m.textContent = meta || path.split("/").slice(0, -1).join("/");
  li.append(name, m);
  li.addEventListener("click", () => choose(path));
  return li;
}

function renderAll(filter = "") {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = notes.filter((p) => terms.every((t) => p.toLowerCase().includes(t))).slice(0, 60);
  $("all").replaceChildren(...hits.map((p) => item(p)));
  return hits;
}

async function init() {
  const { pendingClip } = await chrome.storage.session.get("pendingClip");
  clip = pendingClip;
  if (!clip) return setStatus("Nothing to clip. Close this window.", "error");
  $("heading").textContent = `${LABEL[clip.kind]} from “${clip.title || clip.url}”`;
  $("preview").textContent = clip.markdown.slice(0, 1200);
  $("suggested").replaceChildren(...clip.related.map((n) => item(n.path, n.reason)));
  $("suggestedHeading").hidden = !clip.related.length;
  const map = await chrome.runtime.sendMessage({ type: "vaultMap" });
  if (!map.ok) return setStatus(map.message, "error");
  notes = map.notes;
  $("newNote").textContent = `New note in ${map.inbox || "inbox"} from search text`;
  renderAll();
  $("search").focus();
}

$("search").addEventListener("input", (e) => renderAll(e.target.value));
$("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const hits = renderAll($("search").value);
  if (hits[0]) choose(hits[0]);
});
$("newNote").addEventListener("click", () => {
  const title = $("search").value.trim() || clip?.title || "";
  if (!title) return setStatus("Type a title in the search box first.", "error");
  choose(null, title);
});
document.addEventListener("keydown", (e) => e.key === "Escape" && window.close());

init();
