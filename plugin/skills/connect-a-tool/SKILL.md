---
description: Connect an outside system - Kula, Slack, Salesforce, Google Sheets, Zendesk - when the participant needs data that isn't in the Plum warehouse slices. Use when they say "I need candidate data", "pull from Slack", "connect Salesforce", "read my spreadsheet", "get ticket data", or when load-your-data finds their idea needs a system the warehouse doesn't hold.
---

# Connect an outside system

Some ideas need data that isn't in the warehouse. Each system below plugs into Claude
Code as an MCP server. Install only what this participant actually needs - every extra
server costs context on every turn.

Ask them what they're missing, pick the row, run the command, restart Claude Code.

## Already installed - just needs auth

Kula, Salesforce and Remotion ship with the plugin and start automatically. Don't run
`claude mcp add` for any of them; sending someone to a second copy of the same server is
how you end up with two entries and a confused participant.

| System | Command | Scoped to them? |
|---|---|---|
| Kula (candidates, jobs, interviews) | `/insurwreck:connect` | No - one shared organizer key, same view for everyone, read-only |
| Salesforce (accounts, opportunities, notes) | `/insurwreck:connect` | Yes - browser login, their own profile and sharing rules |
| Remotion docs (programmatic video in React) | nothing - already working | n/a - public docs, no key |

All three are always on, so they cost context on every turn for everyone. If a
participant's idea touches none of them, tell them they can drop one with
`claude mcp remove <name>` for the rest of the day.

Kula has no OAuth and no per-user keys, so don't send anyone to https://developers.kula.ai
expecting to self-serve - the key is organizer-issued and already in their bundle. Three
things to know:
- **Kula is read-only and enforced that way.** The event key is Kula's "full access"
  Application API type and it's shared by all ~25 participants, so a `block-kula-writes.sh`
  hook denies every non-read tool (`create_candidate`, `update_application_stage`, the
  webhook tools, and anything a future release adds). There is no override. If a project
  needs to persist a change, it writes to its own Supabase and demos from there - don't go
  looking for a way around the hook.
- What they read is real candidate data about real people. Say so once, and tell them not to
  put it on a slide or in a Slack channel.
- There is no documented tool that downloads a resume **file**. `get_candidate` may return
  a resume URL as a field. If their idea depends on parsing resume PDFs, verify that early -
  don't discover it at 4pm.

If an idea needs **video**, `remotion` is already connected and answers documentation
questions - but it only searches docs. It renders nothing. Rendering means a real Remotion
project in their repo, and Remotion needs a paid company licence beyond prototype use, so
raise it with an organizer before anyone builds a demo that depends on shipping video.

## What else is ready

### Slack (messages, channels, history)

In Anthropic's official marketplace, so no npm package to trust:

```
/plugin install slack@claude-plugins-official
```

It authenticates through Slack's own OAuth. **Before using it for anything that models a
named colleague, raise consent with an organizer.** Reading a person's years of messages
to imitate how they think is a people question, not a permissions question.

### Salesforce (accounts, opportunities, notes)

Preinstalled - see the table above, and send them to `/insurwreck:connect`. The two hard
rules still hold if you ever reconfigure it by hand:

- **Never add `--toolsets metadata` or `devops`.** Those can deploy and write. The shipped
  config is `--toolsets data --tools run_soql_query`, and SOQL cannot write.
- Point it at the **sandbox**, not production, unless an organizer says otherwise.

If that login stalls or they have no Salesforce account, stop and ask an organizer -
don't burn an hour on it.

### Zendesk (tickets, comments)

Prefer the warehouse slices first: `support_tickets` already carries ticket metadata and
the real SLA numbers, with none of the free-text bodies. Only reach for a live Zendesk
server if they genuinely need comment text, and ask an organizer which repo is pinned for
the event rather than picking one yourself - several competing implementations exist and
they are all community-maintained.

### Google Sheets / Forms / Drive

There is **no official server** for these. Community options exist but each needs a Google
Cloud OAuth client configured, which is a 20-30 minute detour with a real chance of
failing. For a one-day build, the faster path is almost always:

1. Ask them to **export the sheet as CSV**.
2. Use the `load-your-data` skill to parse and seed it into their Supabase project.

Suggest that first. Only set up OAuth if they need live two-way sync, and tell them
honestly what it will cost them in time.

## What isn't available

- **Adobe Sign** - no open server. Reaching it needs a Zapier or Pipedream account plus
  OAuth. For a demo, generate the PDF and show it; don't wire up real e-signature.
- **A wellness calendar** - nothing in the warehouse matches it. The participant supplies
  a sheet, or that part comes out of scope.

## After any install

MCP servers load at startup, so tell them to restart Claude Code once. Then confirm it
worked by asking the server for something small before building on it - a failed
connection discovered now is ten minutes; discovered at demo time it's the whole idea.

If a connector won't authenticate after two attempts, stop and get an organizer. Don't
let a participant spend their build day on credentials.
