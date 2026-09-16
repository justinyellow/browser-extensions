# Config templates

These JSON files are empty of real keys. Copy one, fill it in, then in the extension: Settings → **Import…**.

Do not commit the filled file. `*.local.json` and `*.config.json` are gitignored.

| File | Extension |
|------|-----------|
| [bug-capture.example.json](bug-capture.example.json) | Bug Capture (Anthropic + GitHub + host → repo map) |
| [tab-organizer.example.json](tab-organizer.example.json) | Tab Organizer (Anthropic; Obsidian optional) |
| [vault-context.example.json](vault-context.example.json) | Vault Context (Obsidian; Anthropic only for “Find more with Claude”) |

```bash
cp configs/tab-organizer.example.json tab-organizer.local.json
# edit tab-organizer.local.json, then Import it in Settings
```
