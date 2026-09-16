import { writeNotes } from "./classify.js";
import { inboxFolder, noteTypeForFolder, parseVaultFolders } from "../../shared/para.js";
const PAGE_TEXT_CHARS = 6000;
const NOTES_PER_CALL = 8;
const MAX_NOTE_NAMES = 250;

export function obsidianConfigured(settings) {
  return settings.obsidianEnabled && !!settings.obsidianApiKey;
}

async function vault(settings, method, path, body) {
  const url = `${settings.obsidianUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${settings.obsidianApiKey}`,
      ...(body !== undefined ? { "Content-Type": "text/markdown" } : {}),
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  return res;
}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

async function listDir(settings, dir) {
  const res = await vault(settings, "GET", `/vault/${dir ? `${encodePath(dir)}/` : ""}`);
  if (!res.ok) throw new Error(`Obsidian list failed (${res.status})`);
  return (await res.json()).files || [];
}

export async function testObsidian(settings) {
  try {
    const res = await vault(settings, "GET", "/");
    const data = await res.json();
    if (!data.authenticated) return { ok: false, message: "Connected, but the API key was rejected." };
    const files = await listDir(settings, "");
    return { ok: true, message: `Connected to vault (${files.length} top-level items).` };
  } catch (e) {
    return { ok: false, message: `Can't reach Obsidian at ${settings.obsidianUrl}. Is Obsidian open with the HTTP server enabled? (${e.message})` };
  }
}

// Existing folders (so Claude files into real places) and note names (so it can [[link]] them).
export async function getVaultMap(settings) {
  const { vaultMap } = await chrome.storage.session.get("vaultMap");
  if (vaultMap && Date.now() - vaultMap.at < 10 * 60 * 1000) return vaultMap;

  const folders = [];
  const notes = [];
  const walk = async (dir, depth) => {
    folders.push(dir);
    for (const entry of await listDir(settings, dir)) {
      if (entry.endsWith("/")) {
        if (depth < 2) await walk(`${dir}/${entry.slice(0, -1)}`, depth + 1);
      } else if (entry.endsWith(".md") && dir !== inboxFolder(settings) && notes.length < MAX_NOTE_NAMES) {
        notes.push(entry.slice(0, -3));
      }
    }
  };
  for (const root of parseVaultFolders(settings.vaultFolders)) await walk(root, 0);

  const map = { folders, notes, at: Date.now() };
  await chrome.storage.session.set({ vaultMap: map });
  return map;
}

export async function putVaultFile(settings, path, content) {
  const res = await vault(settings, "PUT", `/vault/${encodePath(path)}`, content);
  if (!res.ok) throw new Error(`Obsidian write failed (HTTP ${res.status})`);
}

function stripHtml(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function getPageText(tab) {
  if (!/^https?:/.test(tab.url)) return "";
  if (!tab.discarded) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (max) => {
          const main = document.querySelector("article, main, [role=main]") || document.body;
          return (main?.innerText || "").replace(/\s+/g, " ").trim().slice(0, max);
        },
        args: [PAGE_TEXT_CHARS],
      });
      if (result?.result) return result.result;
    } catch {}
  }
  try {
    const res = await fetch(tab.url, { credentials: "include", signal: AbortSignal.timeout(8000) });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) return "";
    return stripHtml(await res.text()).slice(0, PAGE_TEXT_CHARS);
  } catch {
    return "";
  }
}

function toFilename(name, fallback) {
  const cleaned = (name || fallback || "Saved-Tab")
    .replace(/\.md$/i, "")
    .replace(/[^A-Za-z0-9\s-]/g, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("-")
    .slice(0, 80);
  return cleaned || "Saved-Tab";
}

async function uniquePath(settings, folder, base) {
  for (let i = 1; i < 50; i++) {
    const path = `${folder}/${base}${i > 1 ? `-${i}` : ""}.md`;
    const res = await vault(settings, "GET", `/vault/${encodePath(path)}`);
    if (res.status === 404) return path;
  }
  throw new Error("Could not find a free filename.");
}

const yamlString = (s) => JSON.stringify(String(s ?? ""));

function buildNote(settings, tab, note, folder) {
  const today = new Date().toLocaleDateString("en-CA");
  const tags = ["tab-organizer", ...(note.tags || [])]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9/-]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);
  return [
    "---",
    `title: ${yamlString(tab.title)}`,
    `source: ${yamlString(tab.url)}`,
    `type: ${noteTypeForFolder(folder, parseVaultFolders(settings.vaultFolders))}`,
    `created: ${today}`,
    `updated: ${today}`,
    "tags:",
    ...[...new Set(tags)].map((t) => `  - ${t}`),
    "---",
    "",
    `# [${tab.title || tab.url}](${tab.url})`,
    "",
    note.body.trim(),
    "",
  ].join("\n");
}

// Returns Map<tabId, notePath> for tabs saved successfully; failures are simply absent.
export async function saveTabsToObsidian(settings, tabs, onUsage) {
  const saved = new Map();
  if (!tabs.length) return saved;
  const { folders, notes } = await getVaultMap(settings);

  for (let i = 0; i < tabs.length; i += NOTES_PER_CALL) {
    const batch = tabs.slice(i, i + NOTES_PER_CALL);
    const withText = await Promise.all(batch.map(async (t) => ({ ...t, content: await getPageText(t) })));
    const { notes: drafts, usage } = await writeNotes(settings, { tabs: withText, folders, notes });
    await onUsage?.(usage);

    const byId = new Map(batch.map((t) => [t.id, t]));
    for (const draft of drafts) {
      const tab = byId.get(draft.tabId);
      if (!tab || saved.has(tab.id)) continue;
      const folder = folders.includes(draft.folder) ? draft.folder : inboxFolder(settings);
      try {
        const path = await uniquePath(settings, folder, toFilename(draft.filename, tab.title));
        await putVaultFile(settings, path, buildNote(settings, tab, draft, folder));
        saved.set(tab.id, path);
      } catch (e) {
        console.warn("[TabOrganizer] Obsidian write failed", tab.url, e);
      }
    }
  }
  return saved;
}
