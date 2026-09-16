import { inboxFolder, noteTypeForFolder, parseVaultFolders } from "../../shared/para.js";
import { getActivity, dateKey } from "./activity.js";
import { writeDigestBody } from "./classify.js";
import { getVaultMap, putVaultFile } from "./obsidian.js";

const TOP_PAGES_PER_GROUP = 8;
const RETRY_AFTER_MS = 30 * 60 * 1000;
const CATCH_UP_DAYS = 3;

export async function buildDigestInput(date) {
  const { pages } = await getActivity(date);
  const byGroup = new Map();
  for (const [url, p] of Object.entries(pages)) {
    const name = p.group || "Ungrouped";
    if (!byGroup.has(name)) byGroup.set(name, { name, minutes: 0, pages: [] });
    const g = byGroup.get(name);
    g.minutes += p.minutes;
    g.pages.push({ title: p.title, url, minutes: p.minutes });
  }
  const groups = [...byGroup.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((g) => ({ ...g, pages: g.pages.sort((a, b) => b.minutes - a.minutes).slice(0, TOP_PAGES_PER_GROUP) }));

  const { cleaned = [] } = await chrome.storage.local.get("cleaned");
  const sameDay = cleaned.filter((c) => dateKey(new Date(c.at)) === date);

  let stillOpen = [];
  if (date === dateKey()) {
    const open = await chrome.tabs.query({ windowType: "normal" });
    stillOpen = open
      .filter((t) => pages[(t.url || "").split("#")[0]])
      .map((t) => ({ title: t.title, url: t.url, minutes: pages[t.url.split("#")[0]].minutes }));
  }

  return {
    date,
    totalMinutes: groups.reduce((s, g) => s + g.minutes, 0),
    groups,
    savedNotes: sameDay.filter((c) => c.action === "obsidian").map((c) => ({ title: c.title, note: c.note })),
    bookmarked: sameDay.filter((c) => c.action === "save").map((c) => c.title),
    closedCount: sameDay.filter((c) => c.action === "close" || c.action === "duplicate").length,
    stillOpen,
  };
}

const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

export async function writeDigest(settings, date, onUsage) {
  const input = await buildDigestInput(date);
  if (!input.totalMinutes && !input.savedNotes.length) {
    return { ok: false, message: `No browsing activity recorded for ${date}.` };
  }

  const { notes } = await getVaultMap(settings);
  const { body, tags, usage } = await writeDigestBody(settings, input, notes);
  await onUsage?.(usage);

  const path = `${inboxFolder(settings)}/Browsing-Digest-${date}.md`;
  const cleanTags = ["browsing-digest", "tab-organizer", ...tags]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9/-]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);
  const content = [
    "---",
    `title: "Browsing Digest ${date}"`,
    `type: ${noteTypeForFolder(inboxFolder(settings), parseVaultFolders(settings.vaultFolders))}`,
    `created: ${date}`,
    `updated: ${dateKey()}`,
    `browsing_time: "${minutesLabel(input.totalMinutes)}"`,
    "tags:",
    ...[...new Set(cleanTags)].map((t) => `  - ${t}`),
    "---",
    "",
    `# Browsing Digest: ${date}`,
    "",
    body.trim(),
    "",
  ].join("\n");

  await putVaultFile(settings, path, content);
  const { digests = {} } = await chrome.storage.local.get("digests");
  digests[date] = path;
  await chrome.storage.local.set({ digests });
  return { ok: true, message: `Digest written to ${path}`, path };
}

// Runs every minute: writes today's digest after the configured hour,
// and catches up on recent days that were missed (Chrome closed early, Obsidian closed).
export async function maybeWriteDigests(settings, onUsage) {
  const { digests = {}, digestStatus = {} } = await chrome.storage.local.get(["digests", "digestStatus"]);
  if (digestStatus.lastAttempt && Date.now() - digestStatus.lastAttempt < RETRY_AFTER_MS) return;

  const due = [];
  for (let back = CATCH_UP_DAYS; back >= 1; back--) {
    due.push(dateKey(new Date(Date.now() - back * 24 * 60 * 60 * 1000)));
  }
  if (new Date().getHours() >= settings.digestHour) due.push(dateKey());

  for (const date of due) {
    if (digests[date]) continue;
    const { pages } = await getActivity(date);
    if (!Object.keys(pages).length) continue;

    await chrome.storage.local.set({ digestStatus: { lastAttempt: Date.now() } });
    try {
      const result = await writeDigest(settings, date, onUsage);
      await chrome.storage.local.set({ digestStatus: { lastAttempt: 0, lastMessage: result.message } });
    } catch (e) {
      await chrome.storage.local.set({
        digestStatus: { lastAttempt: Date.now(), lastMessage: `Digest for ${date} failed: ${e.message}` },
      });
      return;
    }
  }
}
