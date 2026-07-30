---
description: Log in to Salesforce with your own account
---

Salesforce is the one MCP server that needs a per-participant login. Kula needs nothing; it's covered below for when someone asks.

## Salesforce — your own login, your own access

The Salesforce MCP server never takes a password. It reads orgs the `sf` CLI has already authorised, so the participant logs in on Salesforce's own page (SSO and MFA both work) and the session then acts as **them** — their profile, permission sets, and sharing rules. Anything they can't see in Salesforce, the agent can't see either.

1. Check the CLI is present: `sf --version`. If it is missing, `npm i -g @salesforce/cli` (the one-paste setup normally does this; if npm is also missing, run `iw-doctor`).
2. Ask which org to use, and default to the **sandbox**:
   - Sandbox: `sf org login web --instance-url https://test.salesforce.com --alias insurwreck --set-default`
   - Production, only if an organizer said so: `sf org login web --alias insurwreck --set-default`
   
   A browser opens; they sign in as themselves and approve. Nothing is typed into Claude Code.
3. Confirm the org is the default: `sf org display --target-org insurwreck`. Show the username and instance URL it prints, so they can see which identity the agent will use.
4. Verify end to end by calling `run_soql_query` on the `salesforce` MCP server with something small, e.g. `SELECT Id, Name FROM Account LIMIT 3`. No restart is needed — the server resolves `DEFAULT_TARGET_ORG` on every tool call, not at startup.

The server is configured read-only: the `data` toolset with only `run_soql_query`, and SOQL cannot write. Do not add `--toolsets metadata` or `devops` — those can deploy and write.

If the query returns zero rows, that is usually correct rather than broken: they are seeing exactly what their own Salesforce user sees.

## Kula — already on, nothing to authenticate

Kula needs no action from the participant. `/insurwreck:start` puts `KULA_API_KEY` from
their bundle into `~/.claude/settings.json`, so the `kula` server is live after that
restart. If they ask, tell them two things:

- **It's read-only, enforced.** The event key is Kula's "full access" Application API type
  and it is shared by every participant, so `block-kula-writes.sh` denies anything that
  isn't a `list_*`, `get_*`, `search_*` or `autocomplete_*` tool. There is no override. If
  their project needs to persist a change, it writes to their own Supabase and demos from
  there.
- **What they read is real.** Real candidates, real applications, real people. Not a
  de-identified snapshot like the warehouse slices. Nothing goes on a slide or into Slack.

If the `kula` server is failing, it is almost always one of these, in order of likelihood:
they haven't restarted since `/insurwreck:start`; `kula` was still `pending` in their bundle
when it ran, so re-run `/insurwreck:status` to repair it and restart again; or an organizer
hasn't set `KULA_API_KEY` on the desk yet. Check `~/.claude/settings.json` for the key
before assuming anything more exotic.

A denied write is the hook working, not a bug to route around.

Never print `KULA_API_KEY` or the Salesforce access token in full — the service name and
last 4 characters at most.
