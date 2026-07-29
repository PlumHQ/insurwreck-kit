---
description: Remove the Insurwreck kit and optionally your stored credentials
---

Uninstall the Insurwreck kit cleanly.

1. Ask the user whether to also delete their stored credentials at `~/.insurwreck/` (default: keep them, so a reinstall picks them right back up).
2. If they say delete: `rm -rf ~/.insurwreck` and confirm it's gone.
3. Run in Bash: `claude plugin uninstall insurwreck@insurwreck-kit`
4. If the CLI is unavailable or errors, tell them to run `/plugin uninstall insurwreck@insurwreck-kit` themselves (or manage it via `/plugin`).
5. Confirm what was removed and note they can reinstall any time with:
   - `/plugin marketplace add PlumHQ/insurwreck-kit`
   - `/plugin install insurwreck@insurwreck-kit`

Their registration on the event roster is not affected by uninstalling the kit.
