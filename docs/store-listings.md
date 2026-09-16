# Store listing copy

Paste these into each item. Keep one purpose per listing.

Privacy policy: https://github.com/justinyellow/claude-browser-extensions/blob/main/PRIVACY.md

---

## Claude Tab Organizer

**Short description** (≤132 chars)

Groups open Chrome tabs by topic with Claude, closes duplicates and stale tabs, and can save keepers to Obsidian.

**Detailed description**

Claude Tab Organizer watches your open tabs and puts them into named Chrome tab groups by topic.

You supply your own Anthropic API key in Settings (or import a JSON config file). Obsidian is optional and off until you turn it on in Settings; then kept tabs can be saved as notes and a daily digest can be written. Vault folders are configurable; PARA (Inbox / Areas / Projects / Resources) is the default.

The extension can auto-organize after a page loads, close duplicate tabs, and triage tabs you have not viewed in days. Ignored domains are never sent to Claude.

This extension does not create an account and does not send your tabs to the developer. Traffic goes to Anthropic only when you have set a key and a grouping or cleanup run happens, and to your local Obsidian server only if you enable it.

Source: https://github.com/justinyellow/claude-browser-extensions

**Category:** Productivity  
**Language:** English

**Permission justifications**

- **tabs / tabGroups:** Read open tabs and assign Chrome tab groups.
- **storage:** Save settings, API keys, and recent cleanup history on this device.
- **alarms / idle:** Periodic organize and digest runs.
- **scripting:** Optional short page-text snippet for better grouping (can be turned off).
- **bookmarks:** Save kept tabs when Obsidian is not enabled.
- **contextMenus:** Toolbar/context actions for organize/save.
- **Host access (all sites):** Needed to read the current tab’s title, URL, and optional snippet on whatever site you have open. No remote code is injected from a server. You can exclude sites via ignored domains.

**Single purpose:** Organize the user’s Chrome tabs into topic groups.

**Remote code:** None. Claude is called from the extension with the user’s API key.

**User data:** API keys and settings stay in Chrome local storage. Page titles/URLs/optional snippets are sent to Anthropic using the user’s key. See the privacy policy.

---

## Bug Capture

**Short description** (≤132 chars)

Capture a screenshot and console/network errors from your app, then file a Claude-written GitHub issue in the mapped repo.

**Detailed description**

Bug Capture is for people who ship their own web apps. On a mapped host it records recent console errors, uncaught exceptions, and failed requests. One shortcut or toolbar click grabs a screenshot, asks what went wrong, and uses Claude to draft a GitHub issue (title, repro steps, expected/actual, severity). You review the draft, then Create issue.

You map hosts to GitHub repos in Settings (or import a JSON config). Optional GitHub Projects fields and screenshot attach are supported. The Anthropic and GitHub credentials are yours; nothing is sent to the extension author.

Source: https://github.com/justinyellow/claude-browser-extensions

**Category:** Developer tools  
**Language:** English

**Permission justifications**

- **activeTab / tabs:** Know which page you are filing from; open GitHub to attach a screenshot after you confirm.
- **storage:** Settings, tokens, host→repo map, and recent issues on this device.
- **scripting:** Inject a recorder on mapped hosts only, to keep recent console/network failures for the draft.
- **Host access (all sites):** The recorder runs on hosts you list in the repo map (including localhost). Screenshot capture uses the active tab. GitHub.com is opened in a background tab only to attach an image the same way a paste on github.com would. No data is uploaded to a third-party backend besides GitHub and Anthropic with your tokens.

**Single purpose:** File a GitHub issue about a bug on the current page of an app you map.

**Remote code:** None.

**User data:** Keys and mappings stay local. After you click Create issue, the draft and optional screenshot go to GitHub with your token. Claude sees the note, logs, and URL when drafting.

---

## Vault Context

**Short description** (≤132 chars)

See which Obsidian notes relate to the current page, and clip selections, tables, or links into a note.

**Detailed description**

Vault Context connects the page you are on to your local Obsidian vault (Local REST API). The toolbar badge shows how many notes cite this URL or mention the site. Click to open those notes. Optionally, Claude can suggest more related notes if you add an Anthropic key.

Right-click or use the popup to append the selection, a table, or the page link to a note. You pick the note, or create one in your inbox folder. Vault folders are configurable.

The extension talks to localhost (or the REST URL you set). It does not sync your vault to any cloud service.

Source: https://github.com/justinyellow/claude-browser-extensions

**Category:** Productivity  
**Language:** English

**Permission justifications**

- **tabs:** Badge and clip target the active tab.
- **storage:** Settings, API keys, and recent clips on this device.
- **contextMenus:** “Append to Obsidian” on selection/page/link.
- **scripting / content script:** Read the current selection or table to turn it into markdown. Runs on http(s) pages so clip works wherever you browse. Ignored domains skip badge lookups.
- **Host access (all sites):** Required to read the page you are clipping and to look up related notes for that URL. Vault I/O is only to the Obsidian URL you configure.

**Single purpose:** Link the current web page to notes in the user’s Obsidian vault and clip content into those notes.

**Remote code:** None.

**User data:** Obsidian key and optional Anthropic key stay local. Note search/create/append go to your vault. Claude matching (optional) sends title, URL, a short snippet, and note paths to Anthropic with your key.
