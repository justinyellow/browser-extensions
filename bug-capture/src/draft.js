import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    expected: { type: "string" },
    actual: { type: "string" },
    severity: { type: "string", enum: ["blocker", "high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["title", "steps", "expected", "actual", "severity", "notes"],
  additionalProperties: false,
};

const SYSTEM = `You write GitHub bug reports for a developer reporting bugs in their own web apps. You are given the developer's short note, the page they were on, and diagnostics captured from the page (console errors, failed requests). Produce:
- title: one sentence, imperative or descriptive, under 80 chars, specific (mention the page/feature). Don't prefix it with the service name; that is added separately.
- steps: 2-6 numbered-style reproduction steps starting from the URL given. Infer sensible steps from the note and URL; do not invent UI details that are not implied.
- expected / actual: one or two sentences each.
- severity: blocker (app unusable / data loss), high (core flow broken), medium (feature broken with workaround), low (cosmetic).
- notes: 1-3 sentences pointing at the most likely cause when the diagnostics support it (e.g. a 500 from a specific endpoint, an uncaught TypeError). Failed requests tagged [Service (repo)] went to a different service than the page's own; name it when it is the likely cause. Say "No diagnostics captured." if there is nothing useful. Never speculate beyond the evidence.`;

export async function draftIssue(settings, context) {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const prefs = settings.customInstructions?.trim();
  const prompt = `${prefs ? `Project conventions:\n${prefs}\n\n` : ""}Developer note: ${context.note || "(none)"}\n\nPage: ${context.title}\nURL: ${context.url}\nRepo: ${context.repo}${context.service ? `\nService: ${context.service}${context.dir ? ` (code in ${context.dir}/)` : ""}` : ""}\nEnvironment: ${context.environment}\nBrowser: ${context.userAgent}\nViewport: ${context.viewport}\n\nDiagnostics (most recent last):\n${context.diagnostics || "(none)"}`;
  const params = {
    model: settings.model,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  };
  if (!settings.model.startsWith("claude-haiku")) params.output_config.effort = "low";
  const response = await client.beta.messages.create(params);
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Empty response from Claude.");
  return JSON.parse(text);
}

export function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key.";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}: ${error.message}`;
  return error?.message || String(error);
}

export function buildBody(draft, context, { screenshotUrl, diagnostics }) {
  const lines = [
    "## Bug Report",
    "",
    "### Steps to Reproduce",
    ...draft.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "### Expected Behaviour",
    draft.expected,
    "",
    "### Actual Behaviour",
    draft.actual,
    "",
    "### Environment",
    ...(context.service ? [`- Service: ${context.service}${context.dir ? ` (\`${context.dir}/\`)` : ""}`] : []),
    `- Environment: ${context.environment}`,
    `- URL: ${context.url}`,
    `- Browser: ${context.userAgent}`,
    `- Viewport: ${context.viewport}`,
    `- Captured: ${new Date(context.capturedAt).toISOString()}`,
    "",
    "### Severity",
    draft.severity,
    "",
    "### Additional Context",
    draft.notes,
  ];
  if (context.relatedServices?.length) lines.push("", `Failed requests also hit: ${context.relatedServices.join(", ")}`);
  if (context.note) lines.push("", `> Reporter note: ${context.note}`);
  if (screenshotUrl) lines.push("", `![screenshot](${screenshotUrl})`);
  if (diagnostics) {
    lines.push("", "<details><summary>Captured console and network log</summary>", "", "```", diagnostics, "```", "", "</details>");
  }
  lines.push("", "_Filed with Bug Capture._");
  return lines.join("\n");
}
