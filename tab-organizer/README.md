# Claude Tab Organizer

Chrome extension that groups tabs by topic with Claude, cleans up stale and duplicate tabs, and can optionally save tabs worth keeping as notes in Obsidian.

## Install

See the [root README](../README.md#install) for clone and Load unpacked. In this folder:

```bash
npm ci
npm run build
```

Then load the `extension/` directory in `chrome://extensions`. After pulling changes, build again and click Reload.

## Setup

- **Anthropic API key**: extension Settings, or import a config file.
- **Obsidian** (optional, off by default): in Settings, enable “Save kept tabs as notes”, then in Obsidian turn on Local REST API (HTTP) and paste the key. URL is usually `http://127.0.0.1:27123`. Without this, kept tabs go to Chrome bookmarks.

Copy [`../configs/tab-organizer.example.json`](../configs/tab-organizer.example.json), fill in keys, then Settings → **Import…**.

## Controlling how it groups

Chrome cannot nest tab groups, so a shared colour stands in for the company or project and the name is just the workstream — “Code Review”, not “Acme · Code Review”.

- **How finely to group** (Settings, or the popup): *coarse* is one group per project or company, *balanced* splits a company into workstreams, *fine* splits by repo or surface. Standing tools you keep open across every project — calendar, meetings, email, HR, expenses — are grouped by what they are for, and this setting decides whether that is one “Admin” group or several.
- **Your own grouping rules**: free text added to the grouping prompt and applied ahead of the built-in rules, so they win wherever they disagree. While this is set, group names are used exactly as returned, so you can ask for name prefixes if you want them.
- **Extra context for every Claude request**: background that also applies to stale-tab cleanup, notes, and the digest.

After changing any of these, use **Regroup everything** in the popup — a normal run leaves already-grouped tabs where they are.

Settings are stored per machine. If you enable Obsidian, notes sync however your vault syncs. Vault folders are configurable.
