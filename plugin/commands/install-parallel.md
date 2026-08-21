---
description: Switch on the Parallel Search MCP server (organizer-run, on request)
---

Turn on Parallel Search — live web search and fetch — for someone who needs it.

**Not advertised to participants.** Parallel is gated to a short email allowlist
because the key is metered and shared. Nothing here is secret: a participant who
finds it in `/` autocomplete can run it, and the check below tells them whether it
will do anything.

**There is nothing to download.** Unlike `/insurwreck:install-kula`,
`/insurwreck:install-clevertap` and `/insurwreck:install-salesforce`, this server is
Parallel's own hosted HTTP endpoint (`https://search.parallel.ai/mcp`), not an npx
package. So this command is a check and a reload, not an install — and if the key is
already in their settings, `/reload-plugins` on its own is the whole job.

## Step 1 — Check they have the key

The endpoint is declared in the plugin with a `${PARALLEL_API_KEY}` placeholder, and
that only appears in a bundle if the participant is on `PARALLEL_EMAILS` on the desk.
Without it the server starts with an empty bearer token and every call fails
authentication — which looks like the server is broken rather than like a missing
entitlement.

```bash
node -e '
const os=require("os"),fs=require("fs");
const p=os.homedir()+"/.insurwreck/credentials.json";
if(!fs.existsSync(p)){console.log("NO_BUNDLE");process.exit(0)}
const k=(JSON.parse(fs.readFileSync(p,"utf8")).services||{}).parallel;
console.log(k&&k.api_key?"HAS_KEY":"NO_KEY");'
```

- **`HAS_KEY`** — go to Step 2.
- **`NO_KEY`** — they are not on the allowlist, or were not when they last
  provisioned. Tell them Parallel is limited to a named group for this event, and
  point them at the Plum warehouse slices, which every participant has and which
  answer a lot of what people reach for web search to do. If they *should* have it:
  an organizer adds their address to `PARALLEL_EMAILS` on `insurwreck-desk`,
  redeploys, then they run `/insurwreck:status` and `iw-connect`.
- **`NO_BUNDLE`** — they have not onboarded. Send them to `/insurwreck:start`.

## Step 2 — Make the session pick it up

```
/reload-plugins
```

A full restart is only needed if `iw-connect` wrote the key during *this* session -
the `env` block in `settings.json` is read once, when Claude Code starts. If they
have restarted since `iw-connect`, the reload is enough.

Confirm it worked by asking for something the warehouse cannot answer - a current
news item, or a specific public page.

## Step 3 — Tell them the two things that matter

- **Two tools, both read-only:** `web_search` for search inside the reasoning loop,
  and `web_fetch` for pulling a specific URL as markdown. There is no write-block
  hook here because there is nothing to block — the server cannot change anything.
- **The key is metered and shared.** Say it plainly: search deliberately rather than
  crawling, and reach for the Plum slices first for anything they already answer.
  This is the one server where careless use costs the event money rather than
  risking data.
