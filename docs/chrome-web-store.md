# Chrome Web Store listing

The extensions are loadable unpacked today. Use this checklist if you publish later.

## Required for each listing

- [ ] Unique name, short description, and 128×128 icon (already in each `extension/icons/`)
- [ ] Screenshots (1280×800 or 640×400) of the popup and Settings
- [ ] Privacy policy URL pointing at [`PRIVACY.md`](../PRIVACY.md) on the default branch (raw or GitHub Pages)
- [ ] Single-purpose description: one store listing per extension folder, not one listing for the whole repo
- [ ] Permission justifications for `tabs`, `storage`, `<all_urls>` / host permissions, `scripting`, and (where used) `tabGroups`, `bookmarks`, `alarms`, `contextMenus`

## Data-use disclosures

State that:

- Anthropic API keys and GitHub tokens are supplied by the user and stored only in Chrome local storage
- Page content is sent to Anthropic only to run that user-triggered feature
- Bug Capture posts issues to GitHub only after an explicit **Create issue** click
- Obsidian traffic stays on localhost unless the user points the REST URL elsewhere

## Packaging

```bash
cd tab-organizer && npm ci && npm run build && zip -r ../tab-organizer.zip extension
```

Repeat for `bug-capture` and `vault-context`. Zip only the `extension/` folder.

## Review notes

Do not include real API keys, private host maps, or company-internal URLs in screenshots or the uploaded zip.
