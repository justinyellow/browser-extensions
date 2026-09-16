# Vault Context

Chrome extension that connects the page you're on to your Obsidian vault.

- **Badge**: the toolbar icon shows how many vault notes relate to the current page. Green means a note already cites this exact URL; blue means notes mention the site. Click it to see the notes and open any of them in Obsidian.
- **Find more with Claude** (optional): sends the page title, URL and a short text snippet plus your note list to Claude and adds the notes it thinks relate.
- **Clip**: right-click (or use the popup) to append the current selection, a table, or the page link to a note. A picker window suggests the related notes first, lets you search the whole vault, or creates a new note in your inbox folder. Tables come out as markdown tables with a source heading and date.

## Install

See the [root README](../README.md#install) for clone and Load unpacked. In this folder:

```bash
npm ci
npm run build
```

Then load the `extension/` directory in `chrome://extensions`.

## Setup

- **Obsidian**: Settings → Local REST API → enable the non-encrypted (HTTP) server and copy the API key into the extension's Settings (URL `http://127.0.0.1:27123`). Set the vault name so `obsidian://` links open the right vault.
- **Anthropic API key**: only needed for "Find more with Claude".

Copy [`config.example.json`](config.example.json), fill in keys, then Settings → **Import…**. **Export** writes the same format, including secrets — keep it off git.

## Notes

- Lookups use the Local REST API's full-text search: first the exact URL, then the site's name (labels of the hostname). Results are cached for 10 minutes per URL; the Refresh button clears the cache.
- Only notes under the folders listed in Settings are considered (PARA by default). Browsing digests are excluded.
- Domains in the ignore list get no lookups at all. Put your own domain in **Ignored site-name terms** so it is not used as a search term.
