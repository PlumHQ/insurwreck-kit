---
description: Connect your own Keka account to the Insurwreck Keka MCP server
---

Link the participant's personal Keka login to the desk so the `keka` MCP server can act as them. Keka enforces their own permissions — the desk holds no company-wide Keka key, so this grants them nothing they don't already have in the Keka UI.

1. Check `INSURWRECK_TOKEN` is set in the environment. If it is not, read `~/.insurwreck/credentials.json` and take `services.anthropic.api_key`; if there is no bundle at all, tell them to run `/insurwreck:start` first and stop. Tell them to `export INSURWRECK_TOKEN=<key>` in the shell they launch Claude Code from — the same token already authenticates the `insurwreck-data` MCP server, and it does not expire during the event.
2. Start the OAuth flow:
   ```
   curl -s -X POST https://insurwreck-desk.preview.plumhq.com/api/keka \
     -H "authorization: Bearer $INSURWRECK_TOKEN"
   ```
   - `already_connected: true` means they have linked before — say when, and ask whether to re-link before continuing.
   - A 503 means an organizer has not set the Keka OAuth app yet. Say so and stop.
3. Print the `authorize_url` and tell them to open it, log in to Keka, and approve. The link lasts 10 minutes and works once.
4. Wait for them to confirm the browser said "Keka connected", then verify end to end by calling the `keka_whoami` tool on the `keka` MCP server. Show the employee name, work email and department it returns.
5. If the MCP server was already running, its tools work immediately — no restart needed, the token is unchanged and only the desk-side Keka link is new.

If `keka_whoami` says no Keka employee matches their email, the Keka account they authorised carries a different work email; ask which address their Keka profile uses and explain that the desk matches on the email their bundle was issued to.

Never print `INSURWRECK_TOKEN`, the authorize URL's `state`, or any Keka token in full.
