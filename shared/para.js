export const DEFAULT_VAULT_FOLDERS = ["00-Inbox", "10-Areas", "20-Projects", "30-Resources"].join("\n");

export function parseVaultFolders(text) {
  const folders = String(text || "")
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return folders.length ? folders : parseVaultFolders(DEFAULT_VAULT_FOLDERS);
}

export function inboxFolder(settings) {
  return parseVaultFolders(settings?.vaultFolders)[0];
}

export function noteTypeForFolder(folder, roots) {
  const root = String(folder || "").split("/")[0];
  const lower = root.toLowerCase();
  if (lower.includes("inbox")) return "inbox";
  if (lower.includes("area")) return "area";
  if (lower.includes("project")) return "project";
  if (lower.includes("resource")) return "resource";
  if (roots?.[0] && root === roots[0]) return "inbox";
  return "note";
}
