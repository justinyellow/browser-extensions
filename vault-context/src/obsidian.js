import { inboxFolder, parseVaultFolders } from "../../shared/para.js";

const MAX_NOTES = 1500;
const VAULT_MAP_TTL = 10 * 60 * 1000;

export function configured(settings) {
  return !!settings.obsidianApiKey;
}

async function vault(settings, method, path, body, contentType = "text/markdown") {
  const url = `${settings.obsidianUrl.replace(/\/+$/, "")}${path}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${settings.obsidianApiKey}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": contentType } : {}),
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
}

export const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

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
    const { notes } = await getVaultMap(settings, true);
    const roots = parseVaultFolders(settings.vaultFolders);
    return { ok: true, message: `Connected. ${notes.length} notes indexed under ${roots.join(", ")}.` };
  } catch (e) {
    return { ok: false, message: `Can't reach Obsidian at ${settings.obsidianUrl}. Is Obsidian open with the HTTP server enabled? (${e.message})` };
  }
}

// All note paths under the PARA roots, cached briefly so the picker opens instantly.
export async function getVaultMap(settings, force = false) {
  const { vaultMap } = await chrome.storage.session.get("vaultMap");
  if (!force && vaultMap && Date.now() - vaultMap.at < VAULT_MAP_TTL) return vaultMap;

  const notes = [];
  const walk = async (dir, depth) => {
    for (const entry of await listDir(settings, dir)) {
      if (entry.endsWith("/")) {
        if (depth < 4) await walk(`${dir}/${entry.slice(0, -1)}`, depth + 1);
      } else if (entry.endsWith(".md") && notes.length < MAX_NOTES) {
        notes.push(`${dir}/${entry}`);
      }
    }
  };
  for (const root of parseVaultFolders(settings.vaultFolders)) {
    try {
      await walk(root, 0);
    } catch {}
  }
  const map = { notes, at: Date.now() };
  await chrome.storage.session.set({ vaultMap: map });
  return map;
}

// Full-text search. Returns [{ path, score, context }] sorted by score.
export async function search(settings, query, contextLength = 80) {
  const params = new URLSearchParams({ query, contextLength: String(contextLength) });
  const res = await vault(settings, "POST", `/search/simple/?${params}`, "", "application/json");
  if (!res.ok) throw new Error(`Obsidian search failed (${res.status})`);
  const results = await res.json();
  return results
    .filter((r) => r.filename.endsWith(".md") && parseVaultFolders(settings.vaultFolders).some((root) => r.filename.startsWith(`${root}/`)))
    .map((r) => ({ path: r.filename, score: r.score, context: r.matches?.[0]?.context || "" }))
    .sort((a, b) => b.score - a.score);
}

export async function appendToNote(settings, path, markdown) {
  const res = await vault(settings, "POST", `/vault/${encodePath(path)}`, markdown);
  if (!res.ok) throw new Error(`Obsidian append failed (HTTP ${res.status})`);
}

export async function createNote(settings, path, markdown) {
  const res = await vault(settings, "PUT", `/vault/${encodePath(path)}`, markdown);
  if (!res.ok) throw new Error(`Obsidian write failed (HTTP ${res.status})`);
}

export async function noteExists(settings, path) {
  const res = await vault(settings, "GET", `/vault/${encodePath(path)}`);
  return res.ok;
}

export function obsidianUri(settings, path) {
  const file = path.replace(/\.md$/, "");
  return `obsidian://open?vault=${encodeURIComponent(settings.vaultName)}&file=${encodeURIComponent(file)}`;
}

export const noteName = (path) => path.split("/").pop().replace(/\.md$/, "");
export const noteFolder = (path) => path.split("/").slice(0, -1).join("/");
