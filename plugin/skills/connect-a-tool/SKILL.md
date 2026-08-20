---
description: Connect an outside system - Kula, Slack, Salesforce, Google Sheets, Zendesk - when the participant needs data that isn't in the Plum warehouse slices. Use when they say "I need candidate data", "pull from Slack", "connect Salesforce", "read my spreadsheet", "get ticket data", or when load-your-data finds their idea needs a system the warehouse doesn't hold.
---

# Connect an outside system

Some ideas need data that isn't in the warehouse. Each system below plugs into Claude
Code as an MCP server. Install only what this participant actually needs - every extra
server costs context on every turn.

Ask them what they're missing, pick the row, run the command, restart Claude Code.

## Already installed - just needs auth

Kula, Zendesk, CleverTap, Salesforce, Docusign and Remotion ship with the plugin and start
automatically. Don't run `claude mcp add` for any of them; sending someone to a second copy
of the same server is how you end up with two entries and a confused participant.

| System | Command | Scoped to them? |
|---|---|---|
| Kula (candidates, jobs, interviews) | `/insurwreck:connect` | No - one shared organizer key, same view for everyone, read-only |
| Zendesk (support tickets, comments) | nothing - already working | No - one shared organizer token, same view for everyone, read-only |
| CleverTap (campaigns, engagement analytics, member profiles) | nothing - already working | No - one shared organizer credential, same view for everyone, strictly read-only |
| Salesforce (accounts, opportunities, notes) | `/insurwreck:connect` | Yes - browser login, their own profile and sharing rules |
| Docusign (envelopes, e-signature) | `/insurwreck:connect` | Yes - browser login, their own account |
| Remotion docs (programmatic video in React) | nothing - already working | n/a - public docs, no key |

All six are always on, so they cost context on every turn for everyone. If a
participant's idea touches none of them, tell them they can drop one with
`claude mcp remove <name>` for the rest of the day.

Kula has no OAuth and no per-user keys, so don't send anyone to https://developers.kula.ai
expecting to self-serve - the key is organizer-issued and already in their bundle. Three
things to know:
- **Kula is read-only and enforced that way.** The event key is Kula's "full access"
  Application API type and it's shared by every participant, so a `block-kula-writes.sh`
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

### Docusign (envelopes, e-signature)

Preinstalled - see the table above, and send them to `/insurwreck:connect`. First use opens
a browser for Docusign's own OAuth; they sign into their own free developer account (or
make one at https://account-d.docusign.com if they don't have one) and grant access. No
shared credential, no organizer setup.

**Sending an envelope emails a real person with a real signing link - developer accounts
are not a no-op sandbox.** Unlike Kula/Zendesk/CleverTap there's no hook here to stop a bad
send, so the recipient must be their own email or an organizer-approved test address,
never a real name pulled from Kula, Zendesk, CleverTap, or Salesforce data.

### Zendesk (tickets, comments)

Already installed and already authenticated - see the table above. Nothing to run, and
don't go looking for a repo to pin.

Prefer the warehouse slices first anyway: `support_tickets` already carries ticket metadata
and the real SLA numbers, with none of the free-text bodies. Reach for the Zendesk server
only when they genuinely need comment text.

### Google Sheets / Forms / Drive

There is **no official server** for these. Community options exist but each needs a Google
Cloud OAuth client configured, which is a 20-30 minute detour with a real chance of
failing. For a one-day build, the faster path is almost always:

1. Ask them to **export the sheet as CSV**.
2. Use the `load-your-data` skill to parse and seed it into their Supabase project.

Suggest that first. Only set up OAuth if they need live two-way sync, and tell them
honestly what it will cost them in time.

## What isn't available

- **A wellness calendar** - nothing in the warehouse matches it. The participant supplies
  a sheet, or that part comes out of scope.
- **A write path into the Plum app** - there isn't one, and no MCP server creates one. When
  an idea ends with "and the member sees it in the Plum app", that last mile is a mock inside
  their own web UI, and the Next starter already gives them the surface for it. Say so in the
  first conversation rather than on Friday.
- **WhatsApp and Periskope** - no BSP account, no registered number, no Periskope access, and
  none is being provisioned. Build the chatbot and show the conversation flow in a chat UI
  they own. That demos the flow honestly and is strictly less work than the integration.

### Embeddings (only some ideas)

Anthropic serves no embedding model, so vectors come from OpenAI through the same
desk gateway. Check `services.openai` in `~/.insurwreck/credentials.json`:

- **Present** - use their existing `INSURWRECK_TOKEN` as the API key with
  `services.openai.api_base`. There is no OpenAI key to hold and none to ask for.
  `pgvector` is already enabled in their Supabase project, so the vectors have
  somewhere to go.
- **Absent** - embeddings aren't enabled for this idea. Don't route around it:
  the gateway refuses on the server side. If their idea genuinely needs semantic
  search, raise it with an organizer rather than reaching for another provider.

Only `/v1/embeddings` is proxied. Text generation goes to the Anthropic endpoint,
which is what their budget is priced for - a chat call to the OpenAI path is
refused, by design.

## After any install

MCP servers load at startup, so tell them to restart Claude Code once. Then confirm it
worked by asking the server for something small before building on it - a failed
connection discovered now is ten minutes; discovered at demo time it's the whole idea.

If a connector won't authenticate after two attempts, stop and get an organizer. Don't
let a participant spend their build day on credentials.
