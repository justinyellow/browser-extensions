// GitHub has no API for issue attachments. Instead this opens the issue in a background tab, pastes the screenshot
// into the comment box (the same upload the web UI does when you paste an image), reads back the attachment URL
// and clears the box without commenting. Uses the browser's GitHub session, so the image keeps the repo's visibility.
export async function attachScreenshot(issueUrl, dataUrl) {
  const tab = await chrome.tabs.create({ url: issueUrl, active: false });
  try {
    await waitForLoad(tab.id);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pasteIntoCommentBox,
      args: [dataUrl],
    });
    if (!result?.result?.url) throw new Error(result?.result?.error || "Screenshot upload to GitHub failed.");
    return result.result.url;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        done();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("GitHub issue page took too long to load."));
    }, 30000);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && listener(tabId, t));
  });
}

// Runs in the GitHub page, so it must be self-contained.
async function pasteIntoCommentBox(dataUrl) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let box = null;
  for (let i = 0; i < 60 && !box; i++) {
    box = document.querySelector('textarea[placeholder*="comment" i]');
    if (!box) await sleep(250);
  }
  if (!box) return { error: "Couldn't find the comment box on the issue page. Are you signed in to GitHub in this browser?" };

  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], "screenshot.png", { type: "image/png" }));
  box.focus();
  box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));

  let url = null;
  for (let i = 0; i < 120 && !url; i++) {
    await sleep(500);
    url = box.value.match(/https:\/\/github\.com\/user-attachments\/assets\/[\w-]+/)?.[0] || null;
  }
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, "");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return url ? { url } : { error: "GitHub didn't return an attachment URL for the screenshot." };
}
