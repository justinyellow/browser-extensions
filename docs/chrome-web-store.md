# First publish (Chrome Web Store)

The $5 developer fee is paid. First upload of each extension is still **dashboard-only**. The API can update items after they exist.

**Dashboard:** [Developer Console](https://chrome.google.com/webstore/devconsole/bb4c112f-837a-4a5c-83ad-410fc9776260)  
**Publisher ID:** `bb4c112f-837a-4a5c-83ad-410fc9776260`  
**Privacy policy URL:** https://github.com/justinyellow/claude-browser-extensions/blob/main/PRIVACY.md  
**Support / homepage:** https://github.com/justinyellow/claude-browser-extensions

Create **three** items. Zip files (manifest at the zip root):

```bash
npm run pack
```

Produces `dist/bug-capture.zip`, `dist/tab-organizer.zip`, `dist/vault-context.zip`.

For each item: **Add new item** → upload zip → fill Store listing + Privacy using [store-listings.md](store-listings.md) → Distribution: public (or unlisted first) → Submit for review.

2-step verification must be on for the Google account that publishes.

## Later updates (API)

After the first public publish, bump `version` in that extension’s `manifest.json`, run `npm run pack`, then [upload + publish via the v2 API](https://developer.chrome.com/docs/webstore/using-api). Visibility cannot be changed through the API until you have published that visibility once in the dashboard.
