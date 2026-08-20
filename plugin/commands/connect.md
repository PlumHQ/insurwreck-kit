---
description: Log in to Salesforce with your own account
---

Salesforce and Docusign are the two MCP servers that need a per-participant login. Kula, Zendesk and CleverTap need nothing; all three are covered below for when someone asks.

## Salesforce — your own login, your own access

The Salesforce MCP server never takes a password. It reads orgs the `sf` CLI has already authorised, so the participant logs in on Salesforce's own page (SSO and MFA both work) and the session then acts as **them** — their profile, permission sets, and sharing rules. Anything they can't see in Salesforce, the agent can't see either.

1. Check the CLI is present: `sf --version`. If it is missing, `npm i -g @salesforce/cli` (the one-paste setup normally does this; if npm is also missing, run `iw-doctor`).
2. Ask which org to use, and default to the **sandbox**:
   - Sandbox: `sf org login web --instance-url https://test.salesforce.com --alias insurwreck --set-default`
   - Production, only if an organizer said so: `sf org login web --alias insurwreck --set-default`
   
   A browser opens; they sign in as themselves and approve. Nothing is typed into Claude Code.

   **On Windows (WSL):** WSL cannot open a Windows browser by itself, so `sf` prints the URL instead of launching it. That is not a failure — copy the URL into their Windows browser, complete the login there, and `sf` picks up the callback. If they would rather it opened by itself, `sudo apt-get install -y wslu` provides `wslview` and `sf` will use it. `iw-doctor` flags this before they hit it.
3. Confirm the org is the default: `sf org display --target-org insurwreck`. Show the username and instance URL it prints, so they can see which identity the agent will use.
4. Verify end to end by calling `run_soql_query` on the `salesforce` MCP server with something small, e.g. `SELECT Id, Name FROM Account LIMIT 3`. No restart is needed — the server resolves `DEFAULT_TARGET_ORG` on every tool call, not at startup.

The server is configured read-only: the `data` toolset with only `run_soql_query`, and SOQL cannot write. Do not add `--toolsets metadata` or `devops` — those can deploy and write.

If the query returns zero rows, that is usually correct rather than broken: they are seeing exactly what their own Salesforce user sees.

## Docusign — your own login, your own account

The Docusign MCP server is Docusign's official remote server — no npm package to trust,
no shared secret, no Integration Key to register. It authenticates through Docusign's own
OAuth: a browser opens, they sign into their own account (or create a free one at
https://account-d.docusign.com), and approve. Nothing is typed into Claude Code.

1. Ask them to call any Docusign tool — e.g. list templates or envelopes. That first call
   is what triggers the browser login.
2. Confirm the connection with `/mcp`; it should show `docusign` as connected.
3. Verify with a harmless read call (list templates/envelopes) before they build on it.

**Sending an envelope emails a real person with a real signing link, and developer
accounts are not a no-op sandbox — they still send real email.** There is no
`PreToolUse` hook here like there is for Kula/Zendesk/CleverTap, because the whole point
of this server is the write. The recipient must be their own email or an
organizer-approved test address, never a real name pulled from Kula, Zendesk, CleverTap,
or Salesforce data. Say this before their first real send, not after.

If the login stalls or they have no way to make a free developer account, stop and ask an
organizer — don't burn an hour on it.

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

## Zendesk — already on, nothing to authenticate

Same shape as Kula. `/insurwreck:start` puts `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL` and
`ZENDESK_TOKEN` from their bundle into `~/.claude/settings.json`, and the `zendesk` server
is live after that restart. Two things to tell them:

- **It's read-only, enforced.** `block-zendesk-writes.sh` allows `zendesk_search` and
  `zendesk_get_*` and denies everything else, with no override. This matters more than it
  does for Kula: `zendesk_add_public_note` emails the reply to the customer who filed the
  ticket, and `zendesk_create_ticket` drops a fake ticket into a real agent's queue.
- **What they read is real customer support traffic.** Not a de-identified snapshot.
  Nothing goes on a slide or into Slack.

Failures follow the same order as Kula: no restart since `/insurwreck:start`; `zendesk`
still `pending` in the bundle, so re-run `/insurwreck:status`; or an organizer hasn't set
the `ZENDESK_*` values on the desk.

## CleverTap — already on, nothing to authenticate

Same shape as Kula and Zendesk. `/insurwreck:start` puts `CLEVERTAP_ACCOUNT_ID`,
`CLEVERTAP_PASSCODE` and `CLEVERTAP_REGION` from their bundle into
`~/.claude/settings.json`, and the `clevertap` server is live after that restart.
Two things to tell them:

- **It is strictly read-only, and this is the tightest of the three.**
  `block-clevertap-writes.sh` allows exactly `clevertap_get_*`,
  `clevertap_list_projects` and `clevertap_poll`, and denies everything else with
  no override. `clevertap_create_campaign` would send real push, email or SMS to
  real Plum members with no recall, and `clevertap_request` can hit any endpoint
  with any method, so it is blocked by name rather than filtered.
- **What they read is live member engagement data.** Real profiles, real device
  tokens, real campaign performance. Not a de-identified snapshot. Nothing goes on
  a slide or into Slack.

If someone needs a campaign in their demo, the answer is always the same: read the
real numbers with `clevertap_get_campaign_report` / `clevertap_get_message_report`,
model the campaign in their own Supabase, and show that.

**Before troubleshooting, check whether they are meant to have it at all.**
CleverTap is the one service restricted to an explicit email allowlist
(`CLEVERTAP_EMAILS` on the desk), so for most participants `clevertap` staying
`pending` is the correct outcome, not a fault. Do not send them chasing a fix.
Tell them CleverTap is limited to a named group for this event and point them at
the warehouse ticket and NPS slices instead, which every participant has.

If they ARE on the allowlist, failures follow the same order as Kula: no restart
since `/insurwreck:start`; `clevertap` still `pending` in the bundle, so re-run
`/insurwreck:status`; or an organizer hasn't set the `CLEVERTAP_*` values on the
desk.

Never print `KULA_API_KEY`, the `ZENDESK_TOKEN`, the `CLEVERTAP_PASSCODE` or the Salesforce access token in full — the service name and
last 4 characters at most.
