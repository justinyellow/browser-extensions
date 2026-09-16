import Anthropic from "@anthropic-ai/sdk";
import { parseVaultFolders } from "../../shared/para.js";
import { getVaultMap, noteName } from "./obsidian.js";

const SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, reason: { type: "string" } },
        required: ["path", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

export async function matchWithClaude(settings, { title, url, snippet }) {
  const { notes } = await getVaultMap(settings);
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model: settings.model,
    max_tokens: 1500,
    system: `You match a web page to notes in the user's Obsidian vault (folders: ${parseVaultFolders(settings.vaultFolders).join(", ")}). Given the page and the list of note paths, pick up to 6 notes the page genuinely relates to: the same project, area of responsibility, topic, product, or institution. Prefer specific notes over hub notes. If nothing relates, return an empty list. Give a reason under 8 words each.`,
    messages: [
      {
        role: "user",
        content: `Page title: ${title}\nURL: ${url}\nPage text: ${snippet || "(unavailable)"}\n\nNotes:\n${notes.join("\n")}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  };
  if (!settings.model.startsWith("claude-haiku")) params.output_config.effort = "low";
  const response = await client.beta.messages.create(params);
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Empty response from Claude.");
  const known = new Set(notes);
  return JSON.parse(text)
    .matches.filter((m) => known.has(m.path))
    .map((m) => ({ path: m.path, reason: m.reason, name: noteName(m.path), score: 0 }));
}

export function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key.";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}: ${error.message}`;
  return error?.message || String(error);
}
