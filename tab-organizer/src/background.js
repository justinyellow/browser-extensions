import { classifyTabs, triageStaleTabs, describeError, COLORS } from "./classify.js";
import { DEFAULTS } from "./defaults.js";
import { obsidianConfigured, saveTabsToObsidian, testObsidian } from "./obsidian.js";
import { sampleActivity, pruneActivity, dateKey } from "./activity.js";
import { writeDigest, maybeWriteDigests } from "./digest.js";

const MAX_TABS_PER_CALL = 60;
const SNIPPET_CHARS = 400;
const CLEANUP_EVERY_MS = 30 * 60 * 1000;
const CLEANED_LOG_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

async function syncContextMenus() {
  await chrome.contextMenus.removeAll();
  if (!(await getSettings()).obsidianEnabled) return;
  chrome.contextMenus.create({ id: "save-to-obsidian", title: "Save page to Obsidian", contexts: ["page"] });
}

async function setStatus(patch) {
  const { status = {} } = await chrome.storage.local.get("status");
  await chrome.storage.local.set({ status: { ...status, ...patch } });
}

async function addUsage(usage) {
  const { status = {} } = await chrome.storage.local.get("status");
  await setStatus({
    inputTokens: (status.inputTokens || 0) + (usage?.input_tokens || 0),
    outputTokens: (status.outputTokens || 0) + (usage?.output_tokens || 0),
  });
}

// tabId -> url the extension last placed, so manually ungrouped tabs stay put
// and tabs that navigate to a new topic get re-sorted.
async function getProcessed() {
  const { processed = {} } = await chrome.storage.session.get("processed");
  return processed;
}

async function markProcessed(tabs) {
  const processed = await getProcessed();
  for (const t of tabs) processed[t.id] = t.url;
  await chrome.storage.session.set({ processed });
}

// windowId -> when the user last used the window, and when we last re-checked its
// ungrouped tabs. Session-scoped, so a browser restart starts everyone fresh.
async function getWindowActivity() {
  const { touched = {}, rechecked = {} } = await chrome.storage.session.get(["touched", "rechecked"]);
  return { touched, rechecked };
}

async function touchWindow(windowId) {
  if (typeof windowId !== "number" || windowId === chrome.windows.WINDOW_ID_NONE) return;
  const { touched } = await getWindowActivity();
  touched[windowId] = Date.now();
  await chrome.storage.session.set({ touched });
}

async function markRechecked(windowId) {
  const { rechecked } = await getWindowActivity();
  rechecked[windowId] = Date.now();
  await chrome.storage.session.set({ rechecked });
}

// A window earns a re-check once the interval has passed AND the user has actually
// used it since the last one, so windows sitting idle in the background cost nothing.
function shouldRecheck(windowId, settings, { touched, rechecked }) {
  const minutes = Number(settings.recheckMinutes) || 0;
  if (minutes <= 0) return false;
  const last = rechecked[windowId] || 0;
  if ((touched[windowId] || 0) <= last) return false;
  return Date.now() - last >= minutes * 60 * 1000;
}

function parseIgnored(settings) {
  return settings.ignoredDomains
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function isOrganizable(tab, ignored) {
  if (tab.pinned || !tab.url || !/^(https?|file):/.test(tab.url)) return false;
  try {
    const host = new URL(tab.url).hostname;
    return !ignored.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Coarse "what is this tab about" key: host, first two path segments, and search query.
function topicKey(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
    const query = u.searchParams.get("q") || u.searchParams.get("query") || u.searchParams.get("search") || "";
    return `${u.hostname}/${path}?${query}`;
  } catch {
    return url;
  }
}

function withoutHash(url) {
  return url.split("#")[0];
}

async function getSnippet(tab) {
  if (tab.discarded || !/^https?:/.test(tab.url)) return "";
  try {
    const [result] = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (max) => {
          const meta =
            document.querySelector('meta[name="description"]')?.content ||
            document.querySelector('meta[property="og:description"]')?.content ||
            "";
          const body = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
          return `${meta} ${body}`.trim().slice(0, max);
        },
        args: [SNIPPET_CHARS],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
    ]);
    return result?.result || "";
  } catch {
    return "";
  }
}

async function organizeWindow(windowId, { full }, settings, groupColors, activity) {
  const ignored = parseIgnored(settings);
  const allTabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  const processed = await getProcessed();
  const recheck = !full && shouldRecheck(windowId, settings, activity);

  const staleCutoff = settings.cleanupStale ? Date.now() - settings.staleDays * DAY_MS : 0;
  const candidates = allTabs.filter((t) => {
    if (!isOrganizable(t, ignored)) return false;
    // Stale tabs are about to be triaged by cleanup; don't spend a call grouping them.
    if (t.lastAccessed && t.lastAccessed < staleCutoff && !isProtected(t)) return false;
    if (full) return true;
    const placedUrl = processed[t.id];
    // On a re-check, look at every ungrouped tab again: one that had nowhere to go
    // earlier may now belong with tabs opened since.
    if (t.groupId === NO_GROUP) return recheck || placedUrl !== t.url;
    // Grouped tabs: only ones we placed that have since moved to a different topic.
    return placedUrl !== undefined && topicKey(placedUrl) !== topicKey(t.url);
  });
  if (recheck) await markRechecked(windowId);
  if (!candidates.length) return 0;

  const candidateIds = new Set(candidates.map((t) => t.id));
  const titleById = new Map(groups.map((g) => [g.id, g.title]));
  const existingGroups = full
    ? []
    : groups
        .filter((g) => g.title)
        .map((g) => ({
          title: g.title,
          color: g.color,
          sampleTitles: allTabs.filter((t) => t.groupId === g.id && !candidateIds.has(t.id)).map((t) => t.title),
        }));
  const localTitles = new Set(existingGroups.map((g) => g.title.toLowerCase()));
  const otherWindowGroups = [...groupColors.entries()]
    .filter(([key]) => !localTitles.has(key))
    .map(([, g]) => g);

  let placed = 0;
  for (let i = 0; i < candidates.length; i += MAX_TABS_PER_CALL) {
    const batch = candidates.slice(i, i + MAX_TABS_PER_CALL);
    const tabs = await Promise.all(
      batch.map(async (t) => ({
        id: t.id,
        title: t.title || "",
        url: t.url,
        currentGroup: full ? "" : titleById.get(t.groupId) || "",
        snippet: settings.sendPageText ? await getSnippet(t) : "",
      }))
    );

    const { assignments, usage } = await classifyTabs(settings, { existingGroups, otherWindowGroups, tabs });
    placed += await applyAssignments(windowId, assignments, batch, groupColors);
    await markProcessed(batch);
    await addUsage(usage);
  }
  return placed;
}

async function applyAssignments(windowId, assignments, batch, groupColors) {
  const validIds = new Set(batch.map((t) => t.id));
  const byName = new Map();
  for (const a of assignments) {
    if (!validIds.has(a.tabId) || !a.group?.trim()) continue;
    const key = a.group.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, { title: a.group.trim(), color: a.color, tabIds: [] });
    byName.get(key).tabIds.push(a.tabId);
  }

  // Tabs may have closed or already sit in the right group.
  const liveTabs = new Map((await chrome.tabs.query({ windowId })).map((t) => [t.id, t]));
  const currentGroups = await chrome.tabGroups.query({ windowId });

  let placed = 0;
  for (const [key, { title, color, tabIds }] of byName) {
    const match = currentGroups.find((g) => g.title?.toLowerCase() === key);
    const ids = tabIds.filter((id) => liveTabs.has(id) && liveTabs.get(id).groupId !== match?.id);
    if (!ids.length) continue;
    try {
      if (match) {
        await chrome.tabs.group({ groupId: match.id, tabIds: ids });
      } else {
        const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
        const finalColor = groupColors.get(key)?.color || (COLORS.includes(color) ? color : "grey");
        await chrome.tabGroups.update(groupId, { title, color: finalColor });
        currentGroups.push({ id: groupId, title, color: finalColor });
        if (!groupColors.has(key)) groupColors.set(key, { title, color: finalColor });
      }
      placed += ids.length;
    } catch (e) {
      console.warn("[TabOrganizer] group failed", title, e);
    }
  }
  return placed;
}

async function logCleaned(entries) {
  if (!entries.length) return;
  const { cleaned = [] } = await chrome.storage.local.get("cleaned");
  await chrome.storage.local.set({ cleaned: [...entries, ...cleaned].slice(0, CLEANED_LOG_LIMIT) });
}

function isProtected(tab) {
  return tab.active || tab.pinned || tab.audible;
}

async function closeDuplicates(settings) {
  const ignored = parseIgnored(settings);
  const tabs = (await chrome.tabs.query({ windowType: "normal" })).filter((t) => isOrganizable(t, ignored));
  const byUrl = new Map();
  for (const t of tabs) {
    const key = withoutHash(t.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(t);
  }

  const toClose = [];
  for (const dupes of byUrl.values()) {
    if (dupes.length < 2) continue;
    dupes.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    toClose.push(...dupes.slice(1).filter((t) => !isProtected(t)));
  }
  if (!toClose.length) return 0;

  await chrome.tabs.remove(toClose.map((t) => t.id));
  await logCleaned(
    toClose.map((t) => ({ url: t.url, title: t.title, action: "duplicate", reason: "Duplicate tab", at: Date.now() }))
  );
  return toClose.length;
}

async function getFolder(parentId, title) {
  if (!parentId) {
    const found = (await chrome.bookmarks.search({ title })).find((b) => !b.url);
    return found || chrome.bookmarks.create({ title });
  }
  const children = await chrome.bookmarks.getChildren(parentId);
  return children.find((c) => !c.url && c.title === title) || chrome.bookmarks.create({ parentId, title });
}

async function saveBookmark(tab, groupTitle) {
  const root = await getFolder(null, "Tab Organizer");
  const folder = await getFolder(root.id, groupTitle || "Unsorted");
  const existing = await chrome.bookmarks.search({ url: tab.url });
  if (existing.some((b) => b.parentId === folder.id)) return;
  await chrome.bookmarks.create({ parentId: folder.id, title: tab.title || tab.url, url: tab.url });
}

// Obsidian being closed shouldn't break cleanup; callers fall back to bookmarks.
async function saveToVaultSafely(settings, tabs) {
  if (!tabs.length || !obsidianConfigured(settings)) return new Map();
  try {
    return await saveTabsToObsidian(settings, tabs, addUsage);
  } catch (e) {
    console.warn("[TabOrganizer] Obsidian unavailable, using bookmarks", e);
    return new Map();
  }
}

async function saveTabNow(tabId) {
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, message: "Add your Anthropic API key in Settings." };
  if (!obsidianConfigured(settings)) return { ok: false, message: "Set up Obsidian in Settings first." };
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || "")) return { ok: false, message: "Only web pages can be saved." };
  const group = tab.groupId !== NO_GROUP ? (await chrome.tabGroups.get(tab.groupId)).title : "";
  try {
    const paths = await saveTabsToObsidian(settings, [{ ...tab, group }], addUsage);
    const path = paths.get(tab.id);
    return path ? { ok: true, message: `Saved to ${path}` } : { ok: false, message: "Claude didn't produce a note." };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

async function cleanupStale(settings) {
  const ignored = parseIgnored(settings);
  const cutoff = Date.now() - settings.staleDays * DAY_MS;
  const stale = (await chrome.tabs.query({ windowType: "normal" })).filter(
    (t) => isOrganizable(t, ignored) && !isProtected(t) && t.lastAccessed && t.lastAccessed < cutoff
  );
  if (!stale.length) return { saved: 0, closed: 0 };

  const groupTitles = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title]));
  let saved = 0;
  let closed = 0;

  for (let i = 0; i < stale.length; i += MAX_TABS_PER_CALL) {
    const batch = stale.slice(i, i + MAX_TABS_PER_CALL);
    const { decisions, usage } = await triageStaleTabs(
      settings,
      batch.map((t) => ({
        id: t.id,
        title: t.title || "",
        url: t.url,
        group: groupTitles.get(t.groupId) || "",
        daysIdle: Math.floor((Date.now() - t.lastAccessed) / DAY_MS),
      }))
    );
    await addUsage(usage);

    const decisionById = new Map(decisions.map((d) => [d.tabId, d]));
    const toSave = batch.filter((t) => decisionById.get(t.id)?.action === "save");
    const notePaths = await saveToVaultSafely(
      settings,
      toSave.map((t) => ({ ...t, group: groupTitles.get(t.groupId) || "" }))
    );

    const log = [];
    const toClose = [];
    for (const tab of batch) {
      // Tabs Claude skipped stay open.
      const decision = decisionById.get(tab.id);
      if (!decision) continue;
      const group = groupTitles.get(tab.groupId) || "";
      const entry = { url: tab.url, title: tab.title, action: decision.action, reason: decision.reason, group, at: Date.now() };
      if (decision.action === "save") {
        if (notePaths.has(tab.id)) {
          Object.assign(entry, { action: "obsidian", note: notePaths.get(tab.id) });
        } else {
          try {
            await saveBookmark(tab, group);
          } catch (e) {
            console.warn("[TabOrganizer] bookmark failed; leaving tab open", tab.url, e);
            continue;
          }
        }
        saved++;
      } else {
        closed++;
      }
      toClose.push(tab.id);
      log.push(entry);
    }

    // Re-check: don't close anything the user switched to while Claude was working.
    const live = await Promise.all(toClose.map((id) => chrome.tabs.get(id).catch(() => null)));
    const closable = live.filter((t) => t && !isProtected(t) && t.lastAccessed < cutoff).map((t) => t.id);
    if (closable.length) await chrome.tabs.remove(closable);
    await logCleaned(log.filter((_, idx) => closable.includes(toClose[idx])));
  }
  return { saved, closed };
}

let running = false;

async function organize({ full = false, forceCleanup = false } = {}) {
  if (running) return;
  const settings = await getSettings();
  if (!settings.apiKey) {
    await setStatus({ lastError: "Add your Anthropic API key in Options." });
    return;
  }
  running = true;
  await setStatus({ running: true });
  try {
    const { status = {} } = await chrome.storage.local.get("status");
    const patch = { lastError: "" };

    if (settings.closeDuplicates) patch.lastDuplicates = await closeDuplicates(settings);

    const groupColors = new Map(
      (await chrome.tabGroups.query({})).filter((g) => g.title).map((g) => [g.title.toLowerCase(), { title: g.title, color: g.color }])
    );
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const activity = await getWindowActivity();
    let placed = 0;
    for (const w of windows) placed += await organizeWindow(w.id, { full }, settings, groupColors, activity);
    patch.lastPlaced = placed;

    if (settings.cleanupStale && (forceCleanup || Date.now() - (status.lastCleanup || 0) > CLEANUP_EVERY_MS)) {
      const { saved, closed } = await cleanupStale(settings);
      Object.assign(patch, { lastCleanup: Date.now(), lastSaved: saved, lastClosed: closed });
    }

    await setStatus({ ...patch, lastRun: Date.now() });
  } catch (e) {
    console.error("[TabOrganizer]", e);
    await setStatus({ lastError: describeError(e), lastRun: Date.now() });
  } finally {
    running = false;
    await setStatus({ running: false });
  }
}

let debounceTimer;
async function scheduleOrganize() {
  const { autoOrganize, debounceSeconds } = await getSettings();
  if (!autoOrganize) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => organize(), debounceSeconds * 1000);
}

async function syncAlarm() {
  const { autoOrganize, intervalMinutes } = await getSettings();
  await chrome.alarms.clear("organize");
  if (autoOrganize) {
    chrome.alarms.create("organize", { periodInMinutes: Math.max(1, Number(intervalMinutes) || 5) });
  }
  chrome.alarms.create("tick", { periodInMinutes: 1 });
}

let digestRunning = false;
async function onTick() {
  const settings = await getSettings();
  const ignored = parseIgnored(settings);
  await sampleActivity((tab) => isOrganizable(tab, ignored));
  if (!settings.digestEnabled || !settings.apiKey || !obsidianConfigured(settings) || digestRunning) return;
  digestRunning = true;
  try {
    await maybeWriteDigests(settings, addUsage);
  } finally {
    digestRunning = false;
  }
}

async function writeDigestNow() {
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, message: "Add your Anthropic API key in Settings." };
  if (!obsidianConfigured(settings)) return { ok: false, message: "Set up Obsidian in Settings first." };
  try {
    return await writeDigest(settings, dateKey(), addUsage);
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await syncAlarm();
  await syncContextMenus();
  if (reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(async () => {
  await syncAlarm();
  await pruneActivity();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "organize") organize();
  if (alarm.name === "tick") onTick();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  // Only a load in the tab you're looking at counts as using the window; a dashboard
  // refreshing itself in the background shouldn't earn the window a re-check.
  if (tab.active) await touchWindow(tab.windowId);
  scheduleOrganize();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  await touchWindow(windowId);
  scheduleOrganize();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { touched, rechecked } = await getWindowActivity();
  delete touched[windowId];
  delete rechecked[windowId];
  await chrome.storage.session.set({ touched, rechecked });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const processed = await getProcessed();
  if (processed[tabId]) {
    delete processed[tabId];
    await chrome.storage.session.set({ processed });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await touchWindow(windowId);
  const { collapseInactive } = await getSettings();
  if (!collapseInactive) return;
  const tab = await chrome.tabs.get(tabId);
  const groups = await chrome.tabGroups.query({ windowId });
  for (const g of groups) {
    const collapsed = g.id !== tab.groupId;
    if (g.collapsed !== collapsed) {
      chrome.tabGroups.update(g.id, { collapsed }).catch(() => {});
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.autoOrganize || changes.intervalMinutes) syncAlarm();
  if (changes.obsidianEnabled) syncContextMenus();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "organize") {
    organize({ full: !!msg.full, forceCleanup: !!msg.cleanup }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "restore") {
    (async () => {
      const { cleaned = [] } = await chrome.storage.local.get("cleaned");
      const entry = cleaned[msg.index];
      if (entry) {
        await chrome.tabs.create({ url: entry.url, active: false });
        cleaned.splice(msg.index, 1);
        await chrome.storage.local.set({ cleaned });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg.type === "saveTab") {
    saveTabNow(msg.tabId).then(sendResponse);
    return true;
  }
  if (msg.type === "writeDigest") {
    writeDigestNow().then(sendResponse);
    return true;
  }
  if (msg.type === "testObsidian") {
    getSettings().then((settings) => testObsidian({ ...settings, ...msg.overrides }).then(sendResponse));
    return true;
  }
  if (msg.type === "ungroupAll") {
    (async () => {
      const tabs = await chrome.tabs.query({});
      const grouped = tabs.filter((t) => t.groupId !== NO_GROUP).map((t) => t.id);
      if (grouped.length) await chrome.tabs.ungroup(grouped);
      await chrome.storage.session.set({ processed: {} });
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-to-obsidian" || !tab) return;
  const result = await saveTabNow(tab.id);
  await setStatus({ lastSaveMessage: result.message });
  chrome.action.setBadgeText({ tabId: tab.id, text: result.ok ? "✓" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: result.ok ? "#2e7d32" : "#c62828" });
  setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {}), 4000);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "organize-now") organize();
});
