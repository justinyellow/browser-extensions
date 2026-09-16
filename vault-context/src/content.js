// Remembers what was right-clicked and turns selections / tables into markdown on request.
let lastTarget = null;
document.addEventListener("contextmenu", (e) => (lastTarget = e.target), true);

const cell = (el) =>
  (el.innerText || el.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");

function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table);
  if (!rows.length) return "";
  const grid = rows.map((tr) => [...tr.children].filter((c) => /^(td|th)$/i.test(c.tagName)).map(cell));
  const width = Math.max(...grid.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill("")];
  const headerRow = rows[0].querySelector("th") ? pad(grid[0]) : Array(width).fill("");
  const body = rows[0].querySelector("th") ? grid.slice(1) : grid;
  const line = (r) => `| ${r.join(" | ")} |`;
  return [line(headerRow), `| ${Array(width).fill("---").join(" | ")} |`, ...body.filter((r) => r.some(Boolean)).map((r) => line(pad(r)))].join("\n");
}

function pickTable() {
  const under = lastTarget?.closest?.("table");
  if (under) return under;
  const tables = [...document.querySelectorAll("table")].filter((t) => t.querySelectorAll("td, th").length >= 4);
  return tables.sort((a, b) => b.querySelectorAll("td, th").length - a.querySelectorAll("td, th").length)[0] || null;
}

function selectionToMarkdown() {
  const text = window.getSelection()?.toString().trim() || "";
  return text ? text.split(/\n+/).map((l) => `> ${l.trim()}`).join("\n") : "";
}

function pageSnippet(max) {
  const main = document.querySelector("article, main, [role=main]") || document.body;
  return (main?.innerText || "").replace(/\s+/g, " ").trim().slice(0, max);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getClip") {
    if (message.kind === "selection") sendResponse({ markdown: selectionToMarkdown() });
    else if (message.kind === "table") {
      const table = pickTable();
      sendResponse({ markdown: table ? tableToMarkdown(table) : "", caption: table?.caption?.innerText?.trim() || "" });
    } else sendResponse({ markdown: "" });
  } else if (message.type === "getSnippet") sendResponse({ snippet: pageSnippet(message.max || 1500) });
  else if (message.type === "hasSelection") sendResponse({ has: !!window.getSelection()?.toString().trim(), tables: document.querySelectorAll("table").length });
});
