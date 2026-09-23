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
          group: {
            type: "string",
            description: 'Existing group name to reuse, a new specific name, or "" to leave the tab ungrouped.',
          },
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

export const GRANULARITIES = ["coarse", "balanced", "fine"];

export function groupingGranularity(settings) {
  return GRANULARITIES.includes(settings?.groupingGranularity) ? settings.groupingGranularity : "balanced";
}

function granularityRules(level) {
  switch (level) {
    case "coarse":
      return `Granularity: coarse.
A group may cover a whole project, product, trip, or employer when the tabs really are about that one thing. Still split unrelated life areas.`;
    case "balanced":
      return `Granularity: balanced.
Group by workstream. An employer or brand on its own is not a workstream.
Wrong: one group holding that company's code reviews, design files, wiki, and HR pages.
Right: separate groups named "Code Review", "Design", "Payroll" - all sharing one color because they share an employer.`;
    case "fine":
      return `Granularity: fine.
Split workstreams further by surface or artifact. Code reviews, design files, docs, and CI for one product are separate groups. Different repos are separate groups. A pull request list and a design file never share a group.
All of them still share one color when they share a context.`;
    default: {
      const _exhaustive = level;
      throw new Error(`Unknown grouping granularity: ${_exhaustive}`);
    }
  }
}

// Standing tools are the exception to "same specific thing": a calendar and a
// meeting invite are one chore to the user even though they share no project.
function utilityRules(level) {
  switch (level) {
    case "coarse":
      return `Put all of them in one group called "Admin".`;
    case "balanced":
      return `Group them by function, not by project: "Meetings" (calendar, invites, video calls), "Email", "Chat", "Admin" (HR, expenses, IT requests, account and billing settings).`;
    case "fine":
      return `Group them by the individual tool or chore: "Calendar", "Invites", "Email", "Expenses", "HR", "Billing".`;
    default: {
      const _exhaustive = level;
      throw new Error(`Unknown grouping granularity: ${_exhaustive}`);
    }
  }
}

export function groupingInstructions(settings) {
  return settings?.groupingInstructions?.trim() || "";
}

// The user's own rules land in the system prompt, after the defaults, so a rule
// like "keep all my banking tabs apart" beats the guidance it contradicts.
function userRulesSection(instructions) {
  if (!instructions) return "";
  return `

Rules from the user. These are written by the person whose tabs these are, so they outrank everything above whenever they conflict - including the naming, colour, and granularity guidance. The only things they cannot change are the output format: still return exactly one assignment per tab, and still pick a colour from the allowed list.
${instructions}`;
}

export function groupSystemPrompt(level = "balanced", instructions = "") {
  return `You organize a user's open browser tabs into Chrome tab groups.

Chrome cannot nest groups, and a group title only shows a few characters on the tab strip. So context is carried by COLOR and the workstream is carried by the NAME:
- Context (employer, company, product family, life area): expressed only as a shared color. Never written in the name.
- Workstream (the discrete thing the user is doing): this is the group name.

${granularityRules(level)}

Tabs belong together when they are about the same workstream. Sharing an abstract theme - planning, research, work, learning - is not a reason to group tabs together.${
    level === "coarse" ? "" : " Sharing an employer or brand is also not enough."
  }

Standing tools are the one exception. These are the utilities a user keeps open across every project rather than work on one thing: calendar, meeting invites and video calls, email, chat, to-do and ticket queues, HR, payroll, expenses, IT requests, billing and account settings. They genuinely belong together as a chore even though they share no project, so group them by what they are for. ${utilityRules(
    level
  )}
A tab that belongs to one specific project stays with that project - never sweep real project work into a standing-tools group.

Placing tabs:
- Put a tab in an existing group only if it is the same workstream as the tabs already in that group. Judge from the sample titles: if the tab would be the odd one out when the user opens that group, it does not belong there.
${
    level === "coarse"
      ? ""
      : "- If an existing group is named after a company, employer, or umbrella brand, do not add more tabs to it. Give the tab its own workstream name instead - a single tab may start that group, because the alternative is leaving it homeless.\n"
  }- Leave a tab ungrouped by returning "" as the group when nothing genuinely fits. Ungrouped is the right answer for one-off lookups, a single unrelated article, or anything you would only place by stretching a group's meaning. A wrong group costs the user more than no group.
- Create a new group when at least two tabs are about the same workstream. Count everything you can see, not just the tabs in this batch: the sample titles of the existing groups above count too. A batch of one or two tabs is normal on an incremental run and is not a reason to refuse to group them.
- A tab that already has a current group stays in it unless its content now clearly belongs elsewhere${
    level === "coarse" ? "" : ", or that group is named after a company or employer rather than a workstream"
  }.
- Group by what the tab is for, not by website, unless the site itself is the task (e.g. "Email").

Naming:
- Name the group after the workstream alone: "Code Review", "Palette", "Payroll", "Flights", "Kitchen Reno", "Tax Return".
- Never prefix, suffix, or qualify a name with the company, employer, brand, or context it belongs to. "Acme · Code Review", "Acme Code Review" and "Code Review (Acme)" are all wrong - the correct name is "Code Review". The color already says which context it is.
- Never use a separator such as ·, -, :, /, or | to join a context to a workstream.
- Never invent a vague catch-all name such as Planning, Research, Work, Personal, General, Misc, Reading, Shopping or Projects, and never name a group after a company alone. If that is the only name you can think of, the tabs do not belong together - leave them ungrouped.
- The standing-tools names above ("Meetings", "Email", "Admin", "Calendar") are allowed, but only for genuine standing tools. Never use them as a dumping ground for project work.
- 1-2 words, Title Case, short enough to read on a crowded tab strip. Prefer one word when it is unambiguous.
- Reuse an existing group's exact name and color, including names used in other windows, when it is the same workstream (not merely the same employer).
- Colors carry the context: give every group belonging to the same context the same color, and give an unrelated new context a color not already in use.

Return exactly one assignment for every tab listed under "Tabs to place".${userRulesSection(instructions)}`;
}

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

// The model still slips a context prefix in sometimes, and on a crowded tab strip
// "Acme · Code Review" reads as "Acme ·". Keep the workstream half.
export function stripContextPrefix(name) {
  const trimmed = (name || "").trim();
  const parts = trimmed.split(/\s+[·•|:/]\s+|\s+[-–—]\s+/);
  const last = parts[parts.length - 1].trim();
  return parts.length > 1 && last ? last : trimmed;
}

export async function classifyTabs(settings, { existingGroups, otherWindowGroups, tabs }) {
  // Sample titles are what the model judges "same specific thing" against, so show the group's size too:
  // a broad name with six unrelated titles should not attract more tabs.
  const groupLines = existingGroups.length
    ? existingGroups
        .map((g) => `- "${g.title}" (${g.color}, ${g.sampleTitles.length} tabs): ${g.sampleTitles.slice(0, 6).join(" | ")}`)
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
    `Grouping granularity: ${groupingGranularity(settings)}\n\nExisting groups in this window:\n${groupLines}\n\nGroup names used in other windows:\n${otherLines}\n\nTabs to place:\n${tabLines}`
  );
  const instructions = groupingInstructions(settings);
  const system = groupSystemPrompt(groupingGranularity(settings), instructions);
  const { data, usage } = await callClaude(settings, system, prompt, GROUP_SCHEMA);
  // Own rules mean own names: a user who asks for "Acme · Docs" should get it.
  const assignments = instructions
    ? data.assignments
    : data.assignments.map((a) => ({ ...a, group: stripContextPrefix(a.group) }));
  return { assignments, usage };
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
