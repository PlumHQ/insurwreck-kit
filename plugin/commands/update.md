---
description: Update the Insurwreck kit to the latest version
---

Update this plugin to the latest published version.

1. Run in Bash: `claude plugin marketplace update insurwreck-kit`
2. Then run: `claude plugin update insurwreck@insurwreck-kit`
3. If both succeed, tell the user the kit is up to date and that new or changed commands appear in their next Claude Code session (suggest restarting the session if they just pulled command changes).
4. If the `claude plugin` CLI is unavailable or errors, tell the user to run these two slash commands themselves instead, in order:
   - `/plugin marketplace update insurwreck-kit`
   - then reinstall via `/plugin install insurwreck@insurwreck-kit`

Report what version was installed after the update if the CLI output shows it.
