# Claude Tab Organizer

Chrome extension that groups tabs by topic with Claude, cleans up stale and duplicate tabs, and saves tabs worth keeping as notes in an Obsidian vault.

## Install

```bash
npm ci
npm run build
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select the `extension/` folder.

After pulling changes, run `npm run build` again and click reload on the extension card.

## Setup

- **Anthropic API key**: extension Settings, or import a config file.
- **Obsidian** (optional): in Obsidian, Settings → Local REST API → enable the non-encrypted (HTTP) server and copy the API key. Paste the key into the extension's Settings with URL `http://127.0.0.1:27123`.

Copy [`config.example.json`](config.example.json), fill in keys, then Settings → **Import…**. **Export** writes the same format, including secrets — keep it off git.

Settings are stored per machine; notes sync between machines through Obsidian LiveSync (or whatever you use). Vault folders (inbox, areas, projects, resources, or your own list) are configurable in Settings.
