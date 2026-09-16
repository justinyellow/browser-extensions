import { search } from "./obsidian.js";

const GENERIC_LABELS = new Set(["www", "lab", "dev", "app", "apps", "api", "com", "net", "org", "co", "za", "io", "uk", "us", "info", "web", "my", "login", "portal", "docs", "forum", "shop", "store", "help", "support", "admin", "auth", "cloud", "home", "mail", "accounts", "secure", "online"]);
const MAX_RESULTS = 8;

export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

export function hostTerms(url, ignoredTerms = "") {
  const ignored = new Set(ignoredTerms.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean));
  try {
    const host = new URL(url).hostname.toLowerCase();
    return [...new Set(host.split(/[.-]/).filter((l) => l.length >= 4 && !GENERIC_LABELS.has(l) && !ignored.has(l)))];
  } catch {
    return [];
  }
}

export function isIgnored(url, ignoredDomains) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ignoredDomains
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
      .some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

// Cheap, no-AI matching: notes that cite this exact page, then notes mentioning the site's name.
export async function findRelated(settings, url) {
  const canonical = canonicalUrl(url);
  const byPath = new Map();
  const add = (results, reason, weight) => {
    for (const r of results) {
      const existing = byPath.get(r.path);
      const score = r.score * weight;
      if (!existing) byPath.set(r.path, { ...r, reason, score });
      else if (score > existing.score) Object.assign(existing, { score, reason, context: r.context });
    }
  };

  let saved = false;
  const exact = await search(settings, canonical, 0).catch(() => []);
  const strippedExact = canonical.replace(/\/$/, "");
  const alsoExact = strippedExact !== canonical ? await search(settings, strippedExact, 0).catch(() => []) : [];
  const exactAll = [...exact, ...alsoExact].filter((r) => !r.path.includes("Browsing-Digest-"));
  if (exactAll.length) saved = true;
  add(exactAll, "cites this page", 1000);

  for (const term of hostTerms(url, settings.ignoredTerms)) {
    const hits = (await search(settings, term, 80).catch(() => [])).filter((r) => !r.path.includes("Browsing-Digest-"));
    add(hits.slice(0, 20), `mentions "${term}"`, 1);
  }

  const notes = [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  return { saved, notes };
}
