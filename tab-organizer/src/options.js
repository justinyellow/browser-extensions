import { DEFAULTS } from "./defaults.js";
import { fillForm, readForm, wireConfigFile } from "../../shared/config-io.js";

const form = document.getElementById("form");

(async () => {
  fillForm(form, { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) });
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await chrome.storage.local.set(readForm(form, DEFAULTS));
  document.getElementById("saved").textContent = "Saved.";
  setTimeout(() => (document.getElementById("saved").textContent = ""), 2000);
});

wireConfigFile({
  form,
  defaults: DEFAULTS,
  id: "tab-organizer",
  afterImport: (values) => chrome.storage.local.set(values),
});

document.getElementById("testObsidian").addEventListener("click", async () => {
  const out = document.getElementById("obsidianResult");
  out.textContent = "Testing…";
  const result = await chrome.runtime.sendMessage({
    type: "testObsidian",
    overrides: { obsidianUrl: form.elements.obsidianUrl.value.trim(), obsidianApiKey: form.elements.obsidianApiKey.value.trim() },
  });
  out.textContent = result.message;
  out.classList.toggle("error", !result.ok);
});
