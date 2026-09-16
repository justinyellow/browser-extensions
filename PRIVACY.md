# Privacy policy

These Chrome extensions run on your computer. They do not operate a backend of their own, do not create accounts, and do not sell data.

## Data the extensions store locally

Settings, API keys, GitHub tokens, Obsidian keys, site→repo maps, and recent activity (for Tab Organizer) are stored in Chrome’s local extension storage on this device. Config JSON that you export is a copy of that data; keep it private.

## Data sent off the device

Only when you use a feature that needs it:

| Destination | When | What |
|-------------|------|------|
| [Anthropic](https://www.anthropic.com/legal/privacy) | You set an Anthropic API key and trigger grouping, bug drafts, note writing, or “Find more with Claude” | Page titles, URLs, optional short page text, your notes/mapping, and your instructions. Sent with *your* API key. |
| [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) | Bug Capture, after you confirm **Create issue** | Issue title/body, labels, and optional screenshot, using *your* GitHub token (and your GitHub session in Chrome for image attach). |
| Your Obsidian vault (localhost) | Tab Organizer / Vault Context, if you enable the Local REST API | Note search, create, and append requests to the URL you configure (default `http://127.0.0.1:27123`). |

Nothing is sent until you configure the relevant key and use the feature. Ignored domains are never sent to Claude.

## What we do not collect

The maintainers of this repository do not receive telemetry, analytics, or copies of your keys, tabs, vault, or GitHub issues.

## Chrome permissions

The extensions request host access so they can read the current page (and, for Bug Capture, record console/network errors on mapped sites). See each `extension/manifest.json`.

## Contact

Open an issue on the GitHub repository that hosts this project.
