# Claude Tab Organizer

Chrome extension that groups tabs by topic with Claude, cleans up stale and duplicate tabs, and can optionally save tabs worth keeping as notes in Obsidian.

## Install

```bash
npm ci
npm run build
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select the `extension/` folder.

After pulling changes, run `npm run build` again and click reload on the extension card.

## Setup

- **Anthropic API key**: extension Settings, or import a config file.
- **Obsidian** (optional, off by default): in Settings, enable “Save kept tabs as notes”, then in Obsidian turn on Local REST API (HTTP) and paste the key. URL is usually `http://127.0.0.1:27123`. Without this, kept tabs go to Chrome bookmarks.

Copy [`config.example.json`](config.example.json), fill in keys, then Settings → **Import…**. **Export** writes the same format, including secrets — keep it off git.

Settings are stored per machine. If you enable Obsidian, notes sync however your vault syncs. Vault folders are configurable.
