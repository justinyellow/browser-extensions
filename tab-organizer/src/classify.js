import Anthropic from "@anthropic-ai/sdk";

export const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

const GROUP_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tabId: { type: "integer" },
          group: { type: "string" },
          color: { type: "string", enum: COLORS },
        },
        required: ["tabId", "group", "color"],
        additionalProperties: false,
      },
    },
  },
  required: ["assignments"],
  additionalProperties: false,
};

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tabId: { type: "integer" },
          action: { type: "string", enum: ["save", "close"] },
          reason: { type: "string" },
        },
        required: ["tabId", "action", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
};

const GROUP_SYSTEM = `You organize a user's open browser tabs into Chrome tab groups.

Rules:
- Group by topic or task (e.g. "Work", "Shopping", "Taxes", "React docs"), not by website, unless a site is itself the task (e.g. "Email").
- Group names: 1-2 words, Title Case, short enough to read on a tab strip.
- Strongly prefer an existing group when a tab fits it; reuse its exact name and color. A tab listed with a current group should stay there unless its content now clearly belongs elsewhere.
- If a group name from another window fits, reuse that exact name and color so naming stays consistent.
- Aim for a handful of meaningful groups. Merge near-duplicates rather than creating lots of tiny groups.
- Pick a distinct color for each new group where possible.
- Return exactly one assignment for every tab listed under "Tabs to place".`;

const TRIAGE_SYSTEM = `You help a user clean up browser tabs they haven't looked at in days. Each tab will be closed; decide whether it is worth saving as a bookmark first.

"save": something the user would plausibly want to come back to - reference docs, articles or videos they haven't finished, research for an ongoing project, a product they're still deciding on, a repo or tool they're evaluating, anything that would be hard to find again.
"close": clutter - search result pages, login/logout/redirect pages, error pages, completed checkouts or confirmations, one-off lookups (weather, time, conversions), dashboards or inboxes the user can always reopen, near-empty new pages.

When unsure, prefer "save". Keep each reason under 10 words. Return exactly one decision per tab.`;

async function callClaude({ apiKey, model }, system, prompt, schema) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema } },
  };
  if (!model.startsWith("claude-haiku")) params.output_config.effort = "low";
  if (model === "claude-opus-5" || model.startsWith("claude-fable")) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  const response = await client.beta.messages.create(params);
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Response was cut off (too many tabs at once).");

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Empty response from Claude.");
  return { data: JSON.parse(text), usage: response.usage };
}

function withPreferences(settings, prompt) {
  const prefs = settings.customInstructions?.trim();
  return prefs ? `User preferences:\n${prefs}\n\n${prompt}` : prompt;
}

export async function classifyTabs(settings, { existingGroups, otherWindowGroups, tabs }) {
  const groupLines = existingGroups.length
    ? existingGroups
        .map((g) => `- "${g.title}" (${g.color}): ${g.sampleTitles.slice(0, 5).join(" | ")}`)
        .join("\n")
    : "(none)";
  const otherLines = otherWindowGroups.length
    ? otherWindowGroups.map((g) => `- "${g.title}" (${g.color})`).join("\n")
    : "(none)";
  const tabLines = tabs
    .map((t) => {
      const parts = [`tabId=${t.id}`, `title: ${t.title}`, `url: ${t.url}`];
      if (t.currentGroup) parts.push(`current group: ${t.currentGroup}`);
      if (t.snippet) parts.push(`content: ${t.snippet}`);
      return `- ${parts.join("\n  ")}`;
    })
    .join("\n");

  const prompt = withPreferences(
    settings,
    `Existing groups in this window:\n${groupLines}\n\nGroup names used in other windows:\n${otherLines}\n\nTabs to place:\n${tabLines}`
  );
  const { data, usage } = await callClaude(settings, GROUP_SYSTEM, prompt, GROUP_SCHEMA);
  return { assignments: data.assignments, usage };
}

export async function triageStaleTabs(settings, tabs) {
  const tabLines = tabs
    .map((t) => `- tabId=${t.id}\n  title: ${t.title}\n  url: ${t.url}\n  group: ${t.group || "(none)"}\n  last viewed: ${t.daysIdle} days ago`)
    .join("\n");
  const prompt = withPreferences(settings, `Stale tabs:\n${tabLines}`);
  const { data, usage } = await callClaude(settings, TRIAGE_SYSTEM, prompt, TRIAGE_SCHEMA);
  return { decisions: data.decisions, usage };
}

function noteSystem(folders) {
  const roots = [...new Set(folders.map((f) => f.split("/")[0]))];
  return `You turn saved browser tabs into notes for the user's Obsidian vault.
The vault uses these top-level folders: ${roots.join(", ") || "(none listed)"}.
Prefer an existing folder from the list. The first root (${roots[0] || "Inbox"}) is for unsorted notes.

For each tab:
- folder: the single best existing folder from the list.
- filename: Title-Kebab-Case, no extension, descriptive of the content (e.g. "Proxmox-GPU-Passthrough-Guide").
- tags: 1-4 lowercase topic tags.
- body: markdown, written for the user's future self. Use these sections:
  "## Summary" (2-3 sentences), "## Key points" (3-7 bullets of the most useful specifics: numbers, commands, prices, decisions), and "## Related" with [[wikilinks]] to existing notes that genuinely relate (omit the section if none do).
  Only state what the page content supports. If content is missing, write a one-line summary from the title and URL and say the page text wasn't available.
Return exactly one note per tab.`;
}

export async function writeNotes(settings, { tabs, folders, notes }) {
  const schema = {
    type: "object",
    properties: {
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tabId: { type: "integer" },
            folder: { type: "string", enum: folders },
            filename: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            body: { type: "string" },
          },
          required: ["tabId", "folder", "filename", "tags", "body"],
          additionalProperties: false,
        },
      },
    },
    required: ["notes"],
    additionalProperties: false,
  };
  const tabBlocks = tabs
    .map((t) => `<tab id="${t.id}">\ntitle: ${t.title}\nurl: ${t.url}\ntab group: ${t.group || "(none)"}\ncontent: ${t.content || "(unavailable)"}\n</tab>`)
    .join("\n\n");
  const prompt = withPreferences(
    settings,
    `Folders:\n${folders.join("\n")}\n\nExisting notes (for [[links]]):\n${notes.join(", ") || "(none)"}\n\nTabs:\n${tabBlocks}`
  );
  const { data, usage } = await callClaude(settings, noteSystem(folders), prompt, schema);
  return { notes: data.notes, usage };
}

const DIGEST_SYSTEM = `You write a short end-of-day browsing digest for the user's Obsidian vault, for their future self. Tone: plain, factual, never judgmental.

Sections (skip any with nothing to say):
## Focus
Tab groups ranked by time, e.g. "**Work** (2h 10m): what they were actually doing, inferred from page titles". One bullet per meaningful group; fold trivial ones into a final "Other" bullet.
## Saved today
[[Note-Name]] wikilinks (basename without .md) for notes saved today, plus bookmarked titles if any, and how many tabs were closed.
## Unfinished
Pages still open that look like work in progress worth resuming tomorrow, as markdown links.
## Rabbit holes
Topics that took real time but don't connect to any existing project or area note. Only include if clearly present.
## Related notes
[[wikilinks]] to existing vault notes that today's browsing clearly relates to.

Under 300 words. Only use what the data supports. Also return 1-4 lowercase topic tags for the day.`;

export async function writeDigestBody(settings, input, notes) {
  const schema = {
    type: "object",
    properties: { body: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
    required: ["body", "tags"],
    additionalProperties: false,
  };
  const prompt = withPreferences(
    settings,
    `Existing vault notes: ${notes.join(", ") || "(none)"}\n\nBrowsing data:\n${JSON.stringify(input, null, 1)}`
  );
  const { data, usage } = await callClaude(settings, DIGEST_SYSTEM, prompt, schema);
  return { body: data.body, tags: data.tags, usage };
}

export function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Invalid API key.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited; will retry next cycle.";
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error?.message || String(error);
}
