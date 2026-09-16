import { DEFAULTS, parseRepoMap, matchRepo, environmentOf, describeTarget } from "./defaults.js";
import { draftIssue, buildBody, describeError } from "./draft.js";
import { createIssue, updateIssueBody, uploadScreenshot, addToProject, testGithub } from "./github.js";
import { attachScreenshot } from "./attach.js";

const RECORDER_ID = "bug-capture-recorder";

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

// The recorder only runs on hosts that map to a repo, so ordinary browsing is untouched.
async function syncRecorder() {
  const settings = await getSettings();
  const matches = [
    ...new Set(parseRepoMap(settings.repoMap).flatMap((e) => [`*://${e.host}/*`, ...(e.exact ? [] : [`*://*.${e.host}/*`])])),
  ];
  await chrome.scripting.unregisterContentScripts({ ids: [RECORDER_ID] }).catch(() => {});
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: RECORDER_ID, js: ["recorder.js"], matches, runAt: "document_start", world: "MAIN", allFrames: true },
  ]);
}

chrome.runtime.onInstalled.addListener(syncRecorder);
chrome.runtime.onStartup.addListener(syncRecorder);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.repoMap) syncRecorder();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture") chrome.action.openPopup().catch(() => {});
});

const fmtTime = (at) => new Date(at).toLocaleTimeString("en-GB");

// Tags failed requests with the service they hit, so a 500 from another API in the same monorepo is easy to place.
function attributeRequests(entries, pageUrl, repoEntries, pageMatch) {
  const related = new Set();
  const lines = entries.map((e) => {
    let line = `[${fmtTime(e.at)}] ${e.kind}${e.level ? `/${e.level}` : ""}: ${e.message}`;
    const url = e.kind === "network" && e.message.split(" ")[1];
    if (!url) return line;
    let target;
    try {
      target = matchRepo(repoEntries, new URL(url, pageUrl).href);
    } catch {}
    if (target && (target.service !== pageMatch?.service || target.repo !== pageMatch?.repo)) {
      related.add(describeTarget(target));
      line += ` [${describeTarget(target)}]`;
    }
    return line;
  });
  return { lines, related: [...related] };
}

async function collectDiagnostics(tab, repoEntries = [], pageMatch = null) {
  let entries = [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: () => window.__bugCapture?.entries() || [],
    });
    entries = results.flatMap((r) => r.result || []).sort((a, b) => a.at - b.at);
  } catch {}
  let viewport = "";
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    });
    viewport = r?.result || "";
  } catch {}
  const { lines, related } = attributeRequests(entries.slice(-40), tab.url, repoEntries, pageMatch);
  return {
    diagnostics: lines.join("\n"),
    relatedServices: related,
    viewport,
    recorderActive: entries.length > 0 || (await recorderPresent(tab)),
  };
}

async function recorderPresent(tab) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => !!window.__bugCapture,
    });
    return !!r?.result;
  } catch {
    return false;
  }
}

async function capture({ tabId, note, includeScreenshot }) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("No Anthropic API key set. Open Settings.");
  if (!settings.githubToken) throw new Error("No GitHub token set. Open Settings.");
  const tab = await chrome.tabs.get(tabId);
  const entries = parseRepoMap(settings.repoMap);
  const match = matchRepo(entries, tab.url);
  if (!match) throw new Error(`No repo mapped for ${new URL(tab.url).hostname}. Add it in Settings.`);

  let screenshot = null;
  if (includeScreenshot) {
    try {
      screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (e) {
      console.warn("[BugCapture] screenshot failed", e);
    }
  }
  const { diagnostics, relatedServices, viewport } = await collectDiagnostics(tab, entries, match);
  const context = {
    note: note.trim(),
    title: tab.title,
    url: tab.url,
    repo: match.repo,
    service: match.service,
    dir: match.dir,
    environment: environmentOf(tab.url),
    relatedServices,
    userAgent: navigator.userAgent,
    viewport,
    diagnostics,
    capturedAt: Date.now(),
  };
  const draft = await draftIssue(settings, context);
  // Matches the "[Pay] ..." title convention used for monorepo issues.
  if (match.service && !draft.title.startsWith(`[${match.service}]`)) draft.title = `[${match.service}] ${draft.title}`;
  const pending = { draft, context, screenshot, match };
  await chrome.storage.session.set({ pending });
  return pending;
}

async function submit({ title, draft }) {
  const settings = await getSettings();
  const { pending } = await chrome.storage.session.get("pending");
  if (!pending) throw new Error("Nothing to submit; capture again.");
  const { context, screenshot, match } = pending;

  let screenshotUrl = null;
  if (screenshot && settings.screenshotMode === "branch") {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
    const filename = `${new Date(context.capturedAt).toISOString().replace(/[:.]/g, "-")}-${slug}.png`;
    try {
      screenshotUrl = await uploadScreenshot(settings.githubToken, match.repo, settings.screenshotBranch, filename, screenshot);
    } catch (e) {
      console.warn("[BugCapture] screenshot upload failed", e);
    }
  }
  const labels = [...new Set([...settings.labels.split(/[\s,]+/).filter(Boolean), ...(match.labels || [])])];
  const body = (url) => buildBody(draft, context, { screenshotUrl: url, diagnostics: context.diagnostics });
  const issue = await createIssue(settings.githubToken, match.repo, { title, body: body(screenshotUrl), labels });

  if (screenshot && settings.screenshotMode === "attach") {
    try {
      screenshotUrl = await attachScreenshot(issue.url, screenshot);
      await updateIssueBody(settings.githubToken, match.repo, issue.number, body(screenshotUrl));
    } catch (e) {
      console.warn("[BugCapture] screenshot attach failed", e);
      screenshotUrl = null;
    }
  }

  let project = null;
  if (match.projectNumber) {
    try {
      project = await addToProject(settings.githubToken, match.repo, match.projectNumber, issue.nodeId, {
        status: settings.statusValue,
        severity: draft.severity,
      });
    } catch (e) {
      project = { error: e.message };
    }
  }
  await chrome.storage.session.remove("pending");
  const { recent = [] } = await chrome.storage.local.get("recent");
  recent.unshift({ title, url: issue.url, number: issue.number, repo: match.repo, at: Date.now() });
  await chrome.storage.local.set({ recent: recent.slice(0, 20) });
  const screenshotSkipped = !!screenshot && !screenshotUrl;
  // Handed back on failure so the popup can offer to copy it for pasting by hand.
  return { issue, project, screenshotUploaded: !!screenshotUrl, screenshotSkipped, screenshot: screenshotSkipped ? screenshot : null };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    inspect: async ({ tabId }) => {
      const settings = await getSettings();
      const tab = await chrome.tabs.get(tabId);
      const entries = parseRepoMap(settings.repoMap);
      const match = matchRepo(entries, tab.url || "");
      const { diagnostics, recorderActive } = match
        ? await collectDiagnostics(tab, entries, match)
        : { diagnostics: "", recorderActive: false };
      return {
        ok: true,
        match,
        environment: match ? environmentOf(tab.url) : null,
        configured: !!settings.apiKey && !!settings.githubToken,
        diagnosticsCount: diagnostics ? diagnostics.split("\n").length : 0,
        recorderActive,
      };
    },
    capture: async (m) => ({ ok: true, ...(await capture(m)) }),
    submit: async (m) => ({ ok: true, ...(await submit(m)) }),
    discard: async () => {
      await chrome.storage.session.remove("pending");
      return { ok: true };
    },
    testGithub: async ({ token }) => ({ ok: true, message: await testGithub(token) }),
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler(message)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, message: describeError(e) }));
  return true;
});
