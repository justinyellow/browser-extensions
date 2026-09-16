const KEEP_DAYS = 14;
const MAX_PAGES_PER_DAY = 1000;

export const dateKey = (d = new Date()) => d.toLocaleDateString("en-CA");

export async function getActivity(date) {
  const key = `activity_${date}`;
  return (await chrome.storage.local.get(key))[key] || { pages: {} };
}

// Called once a minute: credits a minute to whatever tab you're actually looking at.
export async function sampleActivity(isTracked) {
  if ((await chrome.idle.queryState(120)) !== "active") return;
  const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] }).catch(() => null);
  if (!win?.focused) return;
  const tab = win.tabs.find((t) => t.active);
  if (!tab || !isTracked(tab)) return;

  const group =
    tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
      ? (await chrome.tabGroups.get(tab.groupId).catch(() => null))?.title || ""
      : "";
  const url = tab.url.split("#")[0];
  const date = dateKey();
  const activity = await getActivity(date);
  const page = activity.pages[url];
  if (page) {
    Object.assign(page, { title: tab.title || page.title, group: group || page.group, minutes: page.minutes + 1, last: Date.now() });
  } else if (Object.keys(activity.pages).length < MAX_PAGES_PER_DAY) {
    activity.pages[url] = { title: tab.title || "", group, minutes: 1, first: Date.now(), last: Date.now() };
  }
  await chrome.storage.local.set({ [`activity_${date}`]: activity });
}

export async function pruneActivity() {
  const cutoff = dateKey(new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000));
  const stale = Object.keys(await chrome.storage.local.get(null)).filter(
    (k) => k.startsWith("activity_") && k.slice(9) < cutoff
  );
  if (stale.length) await chrome.storage.local.remove(stale);
}
