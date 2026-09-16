export const DEFAULTS = {
  apiKey: "",
  model: "claude-sonnet-5",
  githubToken: "",
  // One mapping per line: [=]host[:port][/path] owner/repo [project number] [service="…"] [dir="…"] [labels="a,b"].
  // Subdomains of host match too unless it starts with "=".
  repoMap: "",
  labels: "bug",
  statusValue: "Backlog",
  screenshotMode: "attach",
  screenshotBranch: "bug-captures",
  customInstructions: "",
};

function parseTarget(token) {
  const exact = token.startsWith("=");
  const m = token.slice(exact ? 1 : 0).toLowerCase().match(/^([^/:]+)(?::(\d+))?(\/\S*)?$/);
  if (!m) return null;
  return { host: m[1], port: m[2] || "", path: (m[3] || "").replace(/\/+$/, ""), exact };
}

function parseLine(line) {
  if (line.trim().startsWith("#")) return null;
  const [target, repo, ...rest] = line.match(/\w+="[^"]*"|\S+/g) || [];
  if (!repo?.includes("/")) return null;
  const entry = { ...parseTarget(target), repo, projectNumber: null, service: "", dir: "", labels: [] };
  if (!entry.host) return null;
  for (const token of rest) {
    if (/^\d+$/.test(token)) {
      entry.projectNumber = Number(token);
      continue;
    }
    const [, key, value] = token.match(/^(\w+)="?([^"]*)"?$/) || [];
    if (key === "service" || key === "dir") entry[key] = value;
    else if (key === "labels") entry.labels = value.split(",").map((l) => l.trim()).filter(Boolean);
  }
  return entry;
}

export function parseRepoMap(text) {
  return (text || "").split("\n").map(parseLine).filter(Boolean);
}

export function matchRepo(entries, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const hits = entries.filter(
    (e) =>
      (e.exact ? host === e.host : host === e.host || host.endsWith(`.${e.host}`)) &&
      (!e.port || e.port === u.port) &&
      (!e.path || u.pathname === e.path || u.pathname.startsWith(`${e.path}/`))
  );
  // Most specific wins: a port or longer host/path beats "api.example.com", which beats "example.com".
  const score = (e) => (e.port ? 1000 : 0) + e.host.length + e.path.length + (e.exact ? 1 : 0);
  return hits.sort((a, b) => score(b) - score(a))[0] || null;
}

export function environmentOf(url) {
  const host = new URL(url).hostname;
  if (host === "localhost" || host.startsWith("127.")) return "local";
  return host.match(/(?:^|[.-])(dev|staging|uat)(?:api)?(?:[.-]|$)/)?.[1] || "prod";
}

export const describeTarget = (match) => (match.service ? `${match.service} (${match.repo})` : match.repo);
