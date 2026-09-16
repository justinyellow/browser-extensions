export function readForm(form, defaults) {
  const values = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const input = form.elements[key];
    if (!input) {
      values[key] = fallback;
      continue;
    }
    if (input.type === "checkbox") values[key] = input.checked;
    else if (typeof fallback === "number") values[key] = input.value === "" || Number.isNaN(Number(input.value)) ? fallback : Number(input.value);
    else values[key] = input.value.trim();
  }
  return values;
}

export function fillForm(form, settings) {
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
  }
}

export function parseConfig(text, expectedId, defaults) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (data && typeof data === "object" && data.extension && data.extension !== expectedId) {
    throw new Error(`This file is for "${data.extension}", not "${expectedId}".`);
  }
  const raw = data?.settings && typeof data.settings === "object" ? data.settings : data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("No settings object in this file.");
  const settings = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof fallback === "boolean") settings[key] = Boolean(value);
    else if (typeof fallback === "number") {
      const n = Number(value);
      settings[key] = Number.isFinite(n) ? n : fallback;
    } else settings[key] = value == null ? "" : String(value);
  }
  if (!Object.keys(settings).length) throw new Error("No matching settings in this file.");
  return settings;
}

export function downloadConfig(id, settings) {
  const blob = new Blob([`${JSON.stringify({ extension: id, settings }, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `${id}.config.json` });
  a.click();
  URL.revokeObjectURL(url);
}

export function wireConfigFile({ form, defaults, id, afterImport }) {
  const result = document.getElementById("configResult");
  const fileInput = document.getElementById("importFile");
  document.getElementById("exportConfig").addEventListener("click", () => {
    downloadConfig(id, readForm(form, defaults));
    result.textContent = "Downloaded. Keep this file private — it can contain API keys.";
    result.classList.remove("error");
  });
  document.getElementById("importConfig").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const imported = parseConfig(await file.text(), id, defaults);
      fillForm(form, imported);
      await afterImport?.(readForm(form, defaults));
      result.textContent = `Imported ${Object.keys(imported).length} fields and saved.`;
      result.classList.remove("error");
    } catch (err) {
      result.textContent = err.message;
      result.classList.add("error");
    }
  });
}
