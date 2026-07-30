---
description: Connect an outside system - Kula, Slack, Salesforce, Google Sheets, Zendesk - when the participant needs data that isn't in the Plum warehouse slices. Use when they say "I need candidate data", "pull from Slack", "connect Salesforce", "read my spreadsheet", "get ticket data", or when load-your-data finds their idea needs a system the warehouse doesn't hold.
---

# Connect an outside system

Some ideas need data that isn't in the warehouse. Each system below plugs into Claude
Code as an MCP server. Install only what this participant actually needs - every extra
server costs context on every turn.

Ask them what they're missing, pick the row, run the command, restart Claude Code.

## What's ready

### Kula (candidates, jobs, interviews, resumes)

Official Kula server. Auth is a plain API key from https://developers.kula.ai
(Developer Settings) - no OAuth dance.

```
claude mcp add kula -e KULA_API_KEY=<key> -- npx -y @kula-ai/mcp-server
```

Gives ~51 tools: `list_jobs`, `search_candidates`, `get_candidate`, `list_applications`,
`update_application_stage`, `list_scorecard_submissions`, and more.

One thing to check rather than assume: there is no documented tool that downloads a
resume **file**. `get_candidate` may return a resume URL as a field. If the participant's
idea depends on parsing resume PDFs, verify that early - don't discover it at 4pm.

### Slack (messages, channels, history)

In Anthropic's official marketplace, so no npm package to trust:

```
/plugin install slack@claude-plugins-official
```

It authenticates through Slack's own OAuth. **Before using it for anything that models a
named colleague, raise consent with an organizer.** Reading a person's years of messages
to imitate how they think is a people question, not a permissions question.

### Salesforce (accounts, opportunities, notes)

Official Salesforce server. Read-only is achieved by limiting the toolset - the `data`
toolset contains only `run_soql_query`, and SOQL cannot write.

```
claude mcp add salesforce -- npx -y @salesforce/mcp --orgs DEFAULT_TARGET_ORG --toolsets data --tools run_soql_query
```

Two hard rules:
- **Never add `--toolsets metadata` or `devops`.** Those can deploy and write.
- Point it at the **sandbox**, not production, unless an organizer says otherwise.

It needs the Salesforce CLI and a browser login first:

```
npm i -g @salesforce/cli && sf org login web
```

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
