const $ = (id) => document.getElementById(id);
let tab;
let pending;
let failedScreenshot = null;

const setStatus = (text, cls = "muted") => {
  $("status").className = cls;
  $("status").textContent = text;
};

// The editable body in the popup is the draft's steps/expected/actual; the rest is re-assembled on submit.
function draftToText(d) {
  return [
    "Steps to reproduce:",
    ...d.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Expected:",
    d.expected,
    "",
    "Actual:",
    d.actual,
    "",
    "Notes:",
    d.notes,
  ].join("\n");
}

function textToDraft(text, base) {
  const section = (name) => {
    const m = text.match(new RegExp(`${name}:\\n([\\s\\S]*?)(?:\\n\\n[A-Z][a-z ]+:|$)`));
    return (m?.[1] || "").trim();
  };
  const steps = section("Steps to reproduce")
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return {
    ...base,
    steps: steps.length ? steps : base.steps,
    expected: section("Expected") || base.expected,
    actual: section("Actual") || base.actual,
    notes: section("Notes") || base.notes,
    severity: $("severity").value,
  };
}

function showDraft(p) {
  pending = p;
  $("stepNote").hidden = true;
  $("stepDraft").hidden = false;
  $("title").value = p.draft.title;
  $("severity").value = p.draft.severity;
  $("body").value = draftToText(p.draft);
  setStatus(`Drafted for ${p.match.service ? `${p.match.service} in ` : ""}${p.match.repo}${p.screenshot ? " with screenshot" : ""}.`);
}

async function renderRecent() {
  const { recent = [] } = await chrome.storage.local.get("recent");
  $("recent").replaceChildren(
    ...recent.map((r) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = r.url;
      a.target = "_blank";
      a.textContent = `${r.repo.split("/")[1]} #${r.number}: ${r.title}`;
      li.append(a);
      return li;
    })
  );
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const info = await chrome.runtime.sendMessage({ type: "inspect", tabId: tab.id });
  if (!info.configured) {
    setStatus("Set your Anthropic key and GitHub token in Settings.", "error");
    $("capture").disabled = true;
  }
  if (info.match) {
    const proj = info.match.projectNumber ? ` · project #${info.match.projectNumber}` : "";
    const rec = info.recorderActive ? `${info.diagnosticsCount} log entries` : "recorder not active on this page yet (reload it)";
    const service = info.match.service ? `${info.match.service} · ` : "";
    $("target").textContent = `→ ${service}${info.match.repo} (${info.environment})${proj} · ${rec}`;
  } else {
    $("target").textContent = "This site isn't mapped to a repo. Add it in Settings.";
    $("capture").disabled = true;
  }
  const { pending: saved } = await chrome.storage.session.get("pending");
  if (saved && saved.context.url === tab.url) showDraft(saved);
  renderRecent();
}

$("capture").addEventListener("click", async () => {
  $("capture").disabled = true;
  setStatus("Capturing page and drafting with Claude…");
  const result = await chrome.runtime.sendMessage({
    type: "capture",
    tabId: tab.id,
    note: $("note").value,
    includeScreenshot: $("screenshot").checked,
  });
  $("capture").disabled = false;
  if (!result.ok) return setStatus(result.message, "error");
  showDraft(result);
});

$("submit").addEventListener("click", async () => {
  $("submit").disabled = true;
  setStatus("Creating issue…");
  const draft = textToDraft($("body").value, pending.draft);
  const result = await chrome.runtime.sendMessage({ type: "submit", title: $("title").value.trim(), draft });
  $("submit").disabled = false;
  if (!result.ok) return setStatus(result.message, "error");
  $("stepDraft").hidden = true;
  $("stepNote").hidden = false;
  $("note").value = "";
  const parts = [`Created #${result.issue.number}`];
  if (result.project?.projectTitle) parts.push(`added to ${result.project.projectTitle} (${result.project.set.join(", ") || "no fields set"})`);
  if (result.project?.error) parts.push(`project step failed: ${result.project.error}`);
  if (result.screenshotSkipped) parts.push("screenshot upload failed; copy it and paste into the issue");
  setStatus(parts.join(" · "), "ok");
  $("copyScreenshot").hidden = !result.screenshot;
  failedScreenshot = result.screenshot;
  renderRecent();
  chrome.tabs.create({ url: result.issue.url, active: false });
});

$("copyScreenshot").addEventListener("click", async () => {
  const blob = await (await fetch(failedScreenshot)).blob();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  $("copyScreenshot").textContent = "Copied";
});

$("discard").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "discard" });
  $("stepDraft").hidden = true;
  $("stepNote").hidden = false;
  setStatus("");
});

$("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
