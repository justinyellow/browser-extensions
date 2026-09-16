import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VAULT_FOLDERS, inboxFolder, noteTypeForFolder, parseVaultFolders } from "./para.js";
import { parseConfig } from "./config-io.js";

describe("parseVaultFolders", () => {
  it("splits newlines and commas", () => {
    assert.deepEqual(parseVaultFolders("Inbox\nAreas, Projects"), ["Inbox", "Areas", "Projects"]);
  });
  it("falls back to PARA defaults", () => {
    assert.deepEqual(parseVaultFolders(""), parseVaultFolders(DEFAULT_VAULT_FOLDERS));
  });
});

describe("inboxFolder", () => {
  it("uses the first listed folder", () => {
    assert.equal(inboxFolder({ vaultFolders: "Inbox\nProjects" }), "Inbox");
  });
});

describe("noteTypeForFolder", () => {
  it("infers PARA types from names", () => {
    assert.equal(noteTypeForFolder("10-Areas/Health", ["00-Inbox"]), "area");
    assert.equal(noteTypeForFolder("Clips/foo", ["Clips"]), "inbox");
  });
});

describe("parseConfig", () => {
  it("rejects a file for another extension", () => {
    assert.throws(() => parseConfig(JSON.stringify({ extension: "bug-capture", settings: { apiKey: "x" } }), "tab-organizer", { apiKey: "" }), /bug-capture/);
  });
  it("imports matching keys", () => {
    const settings = parseConfig(JSON.stringify({ extension: "tab-organizer", settings: { apiKey: "sk" } }), "tab-organizer", { apiKey: "", model: "claude-opus-5" });
    assert.deepEqual(settings, { apiKey: "sk" });
  });
});
