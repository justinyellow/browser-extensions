# Bug Capture

Chrome extension for filing bugs in your own deployed apps without leaving the page. One click grabs a screenshot, the recent console errors, uncaught exceptions and failed requests, then Claude turns your one-line note into a GitHub issue with a title, repro steps, expected/actual behaviour and a severity. You review the draft, hit **Create issue**, and it lands in the right repo (and project board).

## Install

See the [root README](../README.md#install) for clone and Load unpacked. Shortcut once loaded: `Alt+Shift+B`. In this folder:

```bash
npm ci
npm run build
```

Then load the `extension/` directory in `chrome://extensions`.

## Setup

- **Anthropic API key**: extension Settings, or import a config file (see below).
- **GitHub token**: a fine-grained PAT with Issues (write) on the repos you map, plus Contents (write) for branch screenshots and Projects (write) for project boards. Classic `repo` + `project` scopes also work. For an organization, create the token with that org as the resource owner (it may need org approval); a classic token needs SSO authorization if the org enforces it.
- **Sites → repos**: one line per app, `host owner/repo [project number] [service="…"] [dir="…"] [labels="…"]`. Subdomains match, so `app.example.com` also covers `dev.app.example.com`; `=host` matches that host only, and `:port` / `/path` narrow a line (`localhost:3000`, `api.example.com/v1`). The most specific line wins.

Copy [`config.example.json`](config.example.json), fill in keys and mappings, then Settings → **Import…**. **Export** writes the same format, including secrets — keep it off git.

## How it works

- A recorder script runs at page load on the mapped hosts only. It keeps the last 80 console errors/warnings, uncaught exceptions and non-2xx fetch/XHR responses in memory. Pages open before you install or change the mapping need a reload.
- Screenshots are attached to the issue the same way pasting an image on github.com does: after the issue is created, a background tab opens it, pastes the screenshot into the comment box, takes the attachment URL, clears the box and adds the image to the issue body. It uses your GitHub login in Chrome, so attachments keep the repo's visibility. If that fails, the popup offers **Copy screenshot** to paste by hand. Settings can switch to committing screenshots to a `bug-captures` branch instead.
- When a project number is set, the issue is added to that GitHub Project and the `Status` field is set to the configured value (default `Backlog`). A `Priority` or `Severity` single-select field, if present, is set from the draft's severity.
