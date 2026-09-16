import { DEFAULTS } from "./defaults.js";
import { inboxFolder } from "../../shared/para.js";
import { configured, appendToNote, createNote, noteExists, getVaultMap, testObsidian, noteName } from "./obsidian.js";
import { findRelated, isIgnored, canonicalUrl } from "./related.js";
import { matchWithClaude, describeError } from "./match.js";

const CACHE_TTL = 10 * 60 * 1000;
const MENUS = [
  { id: "clip-selection", title: "Append selection to Obsidian note…", contexts: ["selection"] },
  { id: "clip-table", title: "Append this table to Obsidian note…", contexts: ["page", "selection", "link"] },
  { id: "clip-link", title: "Save page link to Obsidian note…", contexts: ["page", "selection", "link"] },
];

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

chrome.runtime.onInstalled.addListener(() => {
  for (const m of MENUS) chrome.contextMenus.create(m);
});

// --- Related-note badge ---------------------------------------------------

async function setBadge(tabId, { saved, count, error }) {
  const text = error ? "!" : count ? String(count) : "";
  const color = error ? "#d33" : saved ? "#2a8" : "#68c";
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

async function refresh(tabId, url) {
  if (!url || !/^https?:/.test(url)) return setBadge(tabId, {});
  const settings = await getSettings();
  if (!configured(settings) || isIgnored(url, settings.ignoredDomains)) return setBadge(tabId, {});

  const key = `rel:${canonicalUrl(url)}`;
  const { [key]: cached } = await chrome.storage.session.get(key);
  let result = cached && Date.now() - cached.at < CACHE_TTL ? cached : null;
  if (!result) {
    try {
      const { saved, notes } = await findRelated(settings, url);
      result = { saved, notes: notes.map((n) => ({ ...n, name: noteName(n.path) })), at: Date.now() };
    } catch (e) {
      result = { saved: false, notes: [], error: e.message, at: Date.now() };
    }
    await chrome.storage.session.set({ [key]: result });
  }
  await setBadge(tabId, { saved: result.saved, count: result.notes.length, error: !!result.error });
  return result;
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) refresh(tabId, tab.url);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.active) refresh(tabId, tab.url);
});

// --- Clipping --------------------------------------------------------------

async function getClip(tabId, kind, tab) {
  if (kind === "link") return { markdown: `- [${tab.title || tab.url}](${tab.url})` };
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "getClip", kind });
  } catch {
    throw new Error("Can't read this page. Reload it and try again.");
  }
}

async function startClip(kind, tab) {
  const settings = await getSettings();
  if (!configured(settings)) throw new Error("Set your Obsidian API key in Settings first.");
  const clip = await getClip(tab.id, kind, tab);
  if (!clip.markdown) throw new Error(kind === "table" ? "No table found on this page." : "Nothing selected.");
  const related = (await refresh(tab.id, tab.url))?.notes || [];
  await chrome.storage.session.set({
    pendingClip: { kind, markdown: clip.markdown, caption: clip.caption || "", title: tab.title, url: tab.url, related, at: Date.now() },
  });
  await chrome.windows.create({ url: chrome.runtime.getURL("picker.html"), type: "popup", width: 440, height: 560 });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const kind = info.menuItemId.replace("clip-", "");
  startClip(kind, tab).catch((e) => {
    chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    chrome.action.setTitle({ tabId: tab.id, title: `Vault Context: ${e.message}` });
  });
});

function clipBlock(settings, clip) {
  const today = new Date().toLocaleDateString("en-CA");
  const source = `[${clip.title || clip.url}](${clip.url})`;
  if (clip.kind === "link") return `\n${clip.markdown} — ${today}\n`;
  const heading = settings.clipHeading
    ? `\n## ${clip.kind === "table" ? `Table${clip.caption ? `: ${clip.caption}` : ""}` : "Clipped"} from ${source} — ${today}\n\n`
    : "\n";
  return `${heading}${clip.markdown}\n${settings.clipHeading ? "" : `\nSource: ${source} — ${today}\n`}`;
}

function toFilename(name) {
  const cleaned = (name || "Clipped-Page")
    .replace(/[^A-Za-z0-9\s-]/g, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("-")
    .slice(0, 80);
  return cleaned || "Clipped-Page";
}

async function commitClip({ path, newNoteTitle }) {
  const settings = await getSettings();
  const { pendingClip: clip } = await chrome.storage.session.get("pendingClip");
  if (!clip) throw new Error("Nothing to clip.");
  const block = clipBlock(settings, clip);

  if (newNoteTitle) {
    const today = new Date().toLocaleDateString("en-CA");
    let base = toFilename(newNoteTitle);
    const inbox = inboxFolder(settings);
    path = `${inbox}/${base}.md`;
    for (let i = 2; await noteExists(settings, path); i++) path = `${inbox}/${base}-${i}.md`;
    const front = ["---", `title: ${JSON.stringify(newNoteTitle)}`, `source: ${JSON.stringify(clip.url)}`, "type: inbox", `created: ${today}`, `updated: ${today}`, "tags:", "  - vault-context", "---", "", `# ${newNoteTitle}`, ""].join("\n");
    await createNote(settings, path, front + block);
  } else {
    await appendToNote(settings, path, block);
  }
  await chrome.storage.session.remove("pendingClip");
  // The page now cites this note (or the note cites the page); drop the cache so the badge updates.
  await chrome.storage.session.remove(`rel:${canonicalUrl(clip.url)}`);
  const { clips = [] } = await chrome.storage.local.get("clips");
  clips.unshift({ path, kind: clip.kind, title: clip.title, url: clip.url, at: Date.now() });
  await chrome.storage.local.set({ clips: clips.slice(0, 50) });
  return { path };
}

// --- Messages ---------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    related: async ({ tabId, force }) => {
      const tab = await chrome.tabs.get(tabId);
      if (force) await chrome.storage.session.remove(`rel:${canonicalUrl(tab.url || "")}`);
      const result = await refresh(tabId, tab.url);
      return { ok: true, ...(result || { saved: false, notes: [] }), configured: configured(await getSettings()) };
    },
    matchClaude: async ({ tabId }) => {
      const settings = await getSettings();
      if (!settings.apiKey) throw new Error("Set an Anthropic API key in Settings to use Claude matching.");
      const tab = await chrome.tabs.get(tabId);
      const { snippet = "" } = await chrome.tabs.sendMessage(tabId, { type: "getSnippet", max: 1500 }).catch(() => ({}));
      const notes = await matchWithClaude(settings, { title: tab.title, url: tab.url, snippet });
      const key = `rel:${canonicalUrl(tab.url)}`;
      const { [key]: cached } = await chrome.storage.session.get(key);
      const merged = [...(cached?.notes || [])];
      for (const n of notes) if (!merged.some((m) => m.path === n.path)) merged.push(n);
      const result = { ...(cached || { saved: false, at: Date.now() }), notes: merged, claude: true };
      await chrome.storage.session.set({ [key]: result });
      await setBadge(tabId, { saved: result.saved, count: merged.length });
      return { ok: true, ...result };
    },
    clip: async ({ tabId, kind }) => {
      await startClip(kind, await chrome.tabs.get(tabId));
      return { ok: true };
    },
    commitClip: async (m) => ({ ok: true, ...(await commitClip(m)) }),
    vaultMap: async () => {
      const settings = await getSettings();
      return { ok: true, inbox: inboxFolder(settings), ...(await getVaultMap(settings)) };
    },
    settings: async () => ({ ok: true, settings: await getSettings() }),
    testObsidian: async ({ overrides }) => testObsidian({ ...(await getSettings()), ...overrides }),
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler(message)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, message: describeError(e) }));
  return true;
});
