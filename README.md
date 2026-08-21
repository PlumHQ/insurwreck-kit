# insurwreck-kit

The Insurwreck 4.0 build kit: a Claude Code plugin that onboards Leadership Hackathon participants, plus the credential desk API that verifies them and delivers their per-service credentials.

Private during the test phase; goes public before the event. **This repo must never contain secrets** — all master keys live in the desk's Vercel environment.

> **Contributing?** Read [AGENTS.md](AGENTS.md) first. Two rules bite immediately: the desk deploys on push to `main` (never `vercel deploy`), and `git pull --rebase` before every push because several people ship here hourly.

## Getting started (participants)

Three steps, about ten minutes, most of it waiting. You do not need to know anything about terminals, and you will not be asked to copy a single password.

### 1. Open Terminal and paste one line

On a Mac, press `Cmd + Space`, type `Terminal`, hit Enter. Then paste this and press Enter:

```
curl -fsSL https://insurwreck-desk.preview.plumhq.com/go.sh | bash
```

It sets up everything on its own: a proper terminal, the AI assistant you will build with, and the Insurwreck toolkit. It prints a tick for each step. If it asks for your Mac password, that is the installer needing permission to install software - type it and carry on.

Takes three to five minutes. Safe to run twice if something looks wrong; it skips whatever is already done.

**On Windows?** You do not need WSL and you do not need to restart. Open PowerShell from the Start menu - a normal window, not administrator - and paste this instead:

```
irm https://insurwreck-desk.preview.plumhq.com/win | iex
```

It does the same job in the same terminal you already use. It installs Git for Windows on the way through, which is not optional: every safety check in this kit is a bash script, and without a bash on the machine they would silently stop running.

**Already using the Claude app?** Then you do not need to install the assistant - you are already in it. Neither command below installs Claude Code or Ghostty.

*On a Mac*, you do not need a terminal at all. Click the **Code** tab, start a session in any folder, set the mode selector next to the send button to **Auto**, and paste this into the prompt box:

```
Set me up for Insurwreck by running: curl -fsSL https://insurwreck-desk.preview.plumhq.com/gui | bash
```

*On Windows*, the app runs commands through Git Bash, which this setup cannot use, so run it in PowerShell instead. Open PowerShell from the Start menu - a normal window, not administrator - and paste:

```
irm https://insurwreck-desk.preview.plumhq.com/win-gui | iex
```

Either way, when it finishes: **quit the app completely and open it again** - it reads your setup only at launch, so a window that was already open cannot see the new tools. Then click the **Code** tab, open the folder it named, set the mode selector to **Auto**, and type `/insurwreck:start`. Skip step 2.

Auto matters: without it Claude asks permission before each step of setup, and there are a lot of them. The safety checks that count are hooks, which deny outright and run either way - they are not the approval prompts.

If `/insurwreck:start` is not offered, click **+** next to the prompt box, choose **Plugins**, and install **insurwreck** - saying yes when it asks whether you trust the folder.

On a laptop with none of this installed, expect **5 to 10 minutes**, most of it downloading - Git and Node are large. Some steps sit quiet for a couple of minutes. Leave the window open; it is not stuck.

### 2. Sign in and get your toolkit

When it finishes it prints one line to paste, ending in `claude --permission-mode auto`. Paste that. The assistant starts. Then type:

```
/insurwreck:start
```

It asks you three things: your name, your work email, and two sentences about the problem you want to attack. Then it emails you a six-digit code - paste that back in.

While you wait, it builds everything you need behind the scenes: your own website hosting, your own database, your own email inbox that can actually send and receive, and access to Plum data. Give it a minute or two.

**Then quit and start it again.** Close the window, reopen Terminal, and paste the same line the installer gave you. This one restart is what switches the Plum data on. Skip it and the data will look broken.

### 3. Build

Just say what you want in plain English. Some things worth knowing you can ask for:

- **"Show me claims by status"** - you have read access to ten slices of real Plum data: claims, covered lives, support tickets, NPS, policy schedules and more. Ask for what you want; you do not need to know table names.
- **"Deploy this"** - your site goes live on a real URL you can share.
- **"Email me when it finds one"** - you have a working inbox that sends and receives.
- **"Build me a workflow that runs every morning"** - automation you can schedule.

If anything looks stuck, type `iw-doctor`. It checks your whole setup and tells you in plain English what is wrong and what to do about it. If it says quit and restart, that is genuinely the fix.

**About the data:** it is real Plum data with the identifying details removed - no member names, ages grouped into bands, free-text notes stripped out. It is still confidential. Nothing goes into Slack screenshots or onto a slide.

### If you need help

| | |
|---|---|
| `iw-doctor` | checks everything and explains what is broken |
| `iw-status` | shows your setup in a fixed, readable table |
| | *both work inside Claude Code and in your own terminal* |
| `/insurwreck:status` | shows your setup again, and repairs anything that did not finish |
| `/insurwreck:connect` | connects Salesforce or another outside system |
| `/insurwreck:add-google-auth` | adds "Sign in with Google" to your app, Plum accounts only |

Still stuck after `iw-doctor`? Find an organiser. Do not lose twenty minutes to it.

## Bundled MCP servers

All eight start automatically when the plugin installs — they are declared in `plugin/.mcp.json`, so there is no separate install step.

| Server | Package | Official? | Auth | Scoped to the individual? |
|---|---|---|---|---|
| `salesforce` | [`@salesforce/mcp`](https://github.com/salesforcecli/mcp) (Apache-2.0) | Yes — Salesforce DX MCP Server | `sf org login web` — browser OAuth, no password reaches us | **Yes** — acts as their user, with their profile, permission sets and sharing rules |
| `kula` | [`@kula-ai/mcp-server`](https://github.com/kula-ai/kula-mcp-server) (MIT) | Yes — Kula's own server | `KULA_API_KEY`, one shared organizer key, delivered in the bundle | **No** — read-only, enforced by a hook; see below |
| `zendesk` | [`zd-mcp-server`](https://www.npmjs.com/package/zd-mcp-server) (MIT) | No — community server | `ZENDESK_SUBDOMAIN` / `ZENDESK_EMAIL` / `ZENDESK_TOKEN`, one shared organizer token, delivered in the bundle | **No** — read-only, enforced by a hook; see below |
| `clevertap` | [`clevertap-mcp@1.0.0`](https://www.npmjs.com/package/clevertap-mcp) (MIT in [the repo](https://github.com/ralphcorleone/clevertap-mcp); no license field on npm) | No — community server, 6 stars, 3 commits | `CLEVERTAP_ACCOUNT_ID` / `CLEVERTAP_PASSCODE` / `CLEVERTAP_REGION`, one shared organizer credential, delivered in the bundle | **No** — read-only, enforced by a hook; see below |
| `parallel` | [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) — hosted HTTP | Yes — Parallel's own | `PARALLEL_API_KEY` as a bearer token, one shared key, delivered in the bundle | **No** — but read-only by construction, not by hook; see below |
| `insurwreck-data` | ours — `desk/api/mcp.js` | — | `INSURWRECK_TOKEN` | Allowlisted warehouse slices plus the live claims API, same for everyone |
| `n8n` | organizer-hosted | — | `N8N_TOKEN` | Shared workspace |
| `remotion` | [`@remotion/mcp`](https://github.com/remotion-dev/remotion/tree/main/packages/mcp) (MIT) | Yes — Remotion's own | none — unauthenticated, no key | n/a — searches public docs |

Five of the six resolve a `${TOKEN}` placeholder when Claude Code starts, and those tokens do not exist until `/insurwreck:start` has run inside an already-started Claude Code. `/insurwreck:start` closes that gap by running `iw-connect`, which merges `INSURWRECK_TOKEN`, `N8N_TOKEN`, `KULA_API_KEY`, the three `ZENDESK_*` values and the three `CLEVERTAP_*` values from the bundle into `~/.claude/settings.json` without disturbing anything else there, skips whatever is not issued yet, and probes the desk so a rejected token cannot look like a missing one. After one restart `insurwreck-data`, `n8n`, `kula`, `zendesk` and `clevertap` are live.

That restart is the one manual step in onboarding, and it is the step most likely to be skipped - a participant who skips it sees a data server that looks broken. `iw-doctor` names the three states apart: never connected (run `iw-connect`), connected but this session predates it (restart), and connected but rejected (find an organiser).

Only Salesforce needs a login, via `/insurwreck:connect`, because it is the one server that acts with the participant's own identity. A server whose credential is missing fails to connect and the others keep working.

Every server here is always on, so it costs context on every turn for everyone. If that becomes a problem for someone mid-build, an organiser can help them narrow it down - not something to change on your own during the day.

### Salesforce: scoped to the individual

`sf org login web` opens Salesforce's own login page — SSO and MFA both work — and the session then acts as that person, with their profile, permission sets and sharing rules. Anything they can't see in the Salesforce UI, the agent can't see either. The server ships read-only: `--toolsets data --tools run_soql_query`, and SOQL cannot write. Default to the sandbox.

### Kula: shipped, shared, and read-only by force

Kula works, and deliberately not the way Salesforce does. [Kula's authentication docs](https://developers.kula.ai/docs/api-guides/authentication) support bearer API tokens and nothing else — no OAuth flow, no authorization endpoint, no SSO, no per-user keys. One organizer-issued key therefore goes to every participant, and everyone sees the same recruiting pipeline. `mintKula` in `desk/api/_minters.js` delivers it in the bundle and leaves the service `pending` while `KULA_API_KEY` is unset on the desk.

The key issued for this event is the **Application API** type — "full access" in Kula's own docs — and Kula offers no read-only key type. So access is narrowed on our side instead: `plugin/hooks/scripts/block-kula-writes.sh` is a `PreToolUse` hook on `mcp__kula__.*` that allows `list_*`, `get_*`, `search_*` and `autocomplete_*` and denies everything else, with a message telling the participant to write to their own Supabase instead.

Two deliberate choices in that hook:

- **No override.** There is no env var to re-enable writes, and `test-block-kula-writes.sh` asserts that one can't be introduced by accident. Twenty-five agents sharing write access to a live hiring pipeline is not a risk worth an escape hatch.
- **Allow by verb, not deny by name.** Blocking the 11 known write tools would leave a gap the day `@kula-ai/mcp-server` ships a twelfth. Allowing only the four read prefixes means a new write tool is blocked from the moment it exists.

The hook fails open on malformed input — a broken hook must not take Kula down mid-build — so it is a guardrail against an agent doing something careless, not a security boundary against a determined participant. Note what that means concretely: the shared full-access key is written to `~/.claude/settings.json` on ~25 machines, so anyone who wants to can bypass the hook with their own `claude mcp add kula`. The real boundary remains the key's own permissions. Closing that properly means proxying Kula through the desk and exposing read tools only, so the key never leaves Vercel — worth doing if this outlives the hackathon.

**Kula is also gated per participant.** `KULA_EMAILS` on the desk is a comma-separated allowlist and it is **default deny** — unset means nobody is provisioned. `mintKula` throws for anyone not on it, leaving their `kula` service `pending`, so `iw-connect` never writes `KULA_API_KEY` and the server never starts on their machine. Same shape and same helper as `CLEVERTAP_EMAILS`: both call `emailAllowedFor()` in `desk/api/_minters.js`, deliberately one implementation, because a copied second one is how one list quietly starts honouring the other's variable.

Both lists are ordinary Vercel environment variables, editable in the dashboard. A change takes effect on the next deploy and applies only to mints after that — it is a delivery gate, not revocation. Removing an email stops future mints; anyone already provisioned keeps the key in their `~/.claude/settings.json` until their `credentials` row is revoked **and** that key is cleared from their machine.

`/api/admin` reports both lists and their sizes, including a loud `allowlist EMPTY - nobody is provisioned`, because an empty list and a dead credential look identical from a participant's seat.

Run the checks with `bash plugin/hooks/scripts/test-block-kula-writes.sh` and `node desk/test-email-gates.mjs`.

### Zendesk: same shape, sharper edge

Zendesk API tokens authenticate an account rather than a person, so like Kula there is one organizer-issued credential for everyone — three values here, because the token is useless without `ZENDESK_SUBDOMAIN` and the `ZENDESK_EMAIL` it authenticates as. `mintZendesk` in `desk/api/_minters.js` delivers all three and leaves the service `pending` until they are set on the desk.

`plugin/hooks/scripts/block-zendesk-writes.sh` is the same `PreToolUse` shape on `mcp__zendesk__.*`: allow `zendesk_search` and `zendesk_get_*`, deny everything else, no override. The difference from Kula is what a write does. `zendesk_add_public_note` doesn't just edit a record — it emails the reply to the customer who filed the ticket, and there is no undo. `zendesk_create_ticket` puts a fabricated ticket in a real agent's queue.

The same caveat applies as with Kula: the hook is a guardrail against a careless agent, not a boundary against a determined participant, because the token itself is on ~25 machines. Point `ZENDESK_SUBDOMAIN` at a sandbox if one exists.

Run the check with `bash plugin/hooks/scripts/test-block-zendesk-writes.sh`.

### CleverTap: strictly read-only, and version-pinned

Third in the same family, and the one with the least to fall back on. CleverTap's REST API authenticates with an account-level Account ID + Passcode pair — no OAuth, no per-user key, and **no read-only passcode type** — so one full-access credential goes to every participant. `mintClevertap` delivers the pair plus the region and leaves the service `pending` until all of it is set on the desk.

`plugin/hooks/scripts/block-clevertap-writes.sh` is deliberately the strictest of the three: an **exhaustive closed allowlist** of `clevertap_get_*`, `clevertap_list_projects` and `clevertap_poll`, with everything else denied and no override. Two reasons it is tighter than Kula's or Zendesk's:

- **`clevertap_create_campaign` sends.** It posts `/targets/create.json` with `when: "now"` across push, email, SMS, webpush, in-app and webhook. One tool call delivers real messages to real Plum members, with no draft state and no recall.
- **`clevertap_request` takes an arbitrary path and method, including `DELETE`.** Its own tool description offers `POST /upload` as an example, so it defeats any per-tool filter and is denied by name. Note that CleverTap serves several *reads* over POST (`/counts/profiles.json`, `/counts/trends.json`), so filtering by HTTP method would not work even if the hook could see it — the tool name is the only usable signal.

Ordering matters in that hook and there is a test for it: `clevertap_get_campaigns_ui` matches `get_*` by shape but is a dashboard session-replay tool, so the dashboard denials run *before* the allowlist. `test-block-clevertap-writes.sh` caught that exact bug during development.

**The version pin is load-bearing.** `plugin/.mcp.json` pins `clevertap-mcp@1.0.0` because the published build is not the repo's `main`: v1.0.0 has `tools/web.ts` commented out (`// TODO: next version`), so the Playwright login, dashboard session replay and `clevertap_send_test_push` are never registered, and no Chromium binary is needed. An unpinned `npx -y clevertap-mcp` would silently hand every participant those tools the day 1.1.0 ships. The hook denies them anyway, as defence in depth.

A supply-chain note for whoever maintains this next: the npm package carries no `license`, `repository` or `author` field, and its maintainer (`leanderdperez`) is a different identity from the GitHub owner (`ralphcorleone`). The tarball ships its own `src/`, and it was diffed against the repo at review time — byte-identical apart from CRLF line endings and the two files above. Re-do that diff before moving the pin.

**CleverTap is also the one service gated per participant.** `CLEVERTAP_EMAILS` on the desk is a comma-separated allowlist and it is **default deny** — unset means nobody is provisioned. `mintClevertap` throws for anyone not on it, which leaves their `clevertap` service `pending`, so `iw-connect` never writes the three `CLEVERTAP_*` variables and the server never starts on their machine. There is nothing to block and nothing to explain, because the tools are not there.

That is a *delivery* gate, not an API scope — CleverTap has no per-user credential to scope to, which is precisely why the gate has to sit on our side. Two consequences worth writing down:

- **It does not revoke.** Removing an email stops future mints. Anyone already provisioned keeps the passcode in their `~/.claude/settings.json`; taking it back means revoking their `credentials` row *and* clearing those three keys on their machine.
- **`/api/admin` reports the allowlist size**, including a loud `allowlist EMPTY - nobody is provisioned`. An empty list and a broken credential look identical from a participant's seat, so the panel names which one it is.

**Two graded exceptions exist, each its own list.** The desk resolves a level and delivers it as `INSURWRECK_CLEVERTAP_ACCESS`, so who holds what is a recorded decision rather than a local edit on a laptop.

| Level | List | Adds |
|---|---|---|
| `campaign` | `CLEVERTAP_CAMPAIGN_EMAILS` | `create_campaign`, `stop_campaign` — nothing else |
| `full` | `CLEVERTAP_FULL_EMAILS` | every write the pinned server registers, including `delete_profile`, `subscribe` (consent) and `clevertap_request` |

Three lists rather than one column, because each step up is its own decision: reading engagement analytics, sending to real members, and deleting profiles are not the same trust. One combined list would hide the bigger grant inside the smaller one.

**`clevertap_configure` is denied even at `full`**, and that is not an oversight. It grants no capability — the credentials are already wired into the server — and its only effect is printing the shared Account ID and passcode back as text, putting a credential that belongs to everyone on the key into one person's transcript. *Full access to the data* and *leak the shared secret* are different things.

The dashboard tools stay denied at every level too, so if the version pin ever moves they cannot become reachable through a data grant.

**One thing to know before granting `full` to solve a drafting problem: it will not solve it.** The API has no save-as-draft — `create_campaign` only launches, immediately or at a scheduled time. Save Draft exists only in the dashboard UI, and `clevertap-mcp@1.0.0` does not register the dashboard tools. Verified against the running server: 28 tools, none of them `web_*`.

Run the checks with `bash plugin/hooks/scripts/test-block-clevertap-writes.sh` and `node desk/test-clevertap-gate.mjs` (the gate test asserts the empty-list default, case/whitespace handling, and that listing one person never implies the domain).

### Parallel: gated for cost, not for safety

The third email-gated service, on the same `emailAllowedFor()` helper — `PARALLEL_EMAILS`, default deny. The reason is different from the other two and worth being explicit about: Parallel is a **metered** web-search API, and one shared key spent by 137 people is a bill nobody chose. Nothing about it is dangerous.

**It carries no write-block hook, and that is a reading rather than an omission.** The server exposes exactly two tools — `web_search` and `web_fetch` — and neither writes anywhere. A hook allowing both and denying everything else would be honest, but it would be the only hook in this kit protecting nothing, which makes the other three look decorative by association.

It is also the only third-party server with **nothing to install**: Parallel hosts it, so there is no npx package, nothing to prewarm, and `/insurwreck:install-parallel` is a credential check plus `/reload-plugins` rather than a download.

What participants should be told is the cost, not the risk: search deliberately rather than crawl, and reach for the warehouse slices first for anything they already answer.

## Layout

- `.claude-plugin/marketplace.json` — makes this repo installable as a Claude Code plugin marketplace.
- `plugin/` — the `insurwreck` plugin (commands only, no secrets, no code execution beyond curl to the desk).
- `plugin/.mcp.json` — MCP servers shipped with the plugin. Keys come from the participant's environment, never this repo.
- `desk/` — the credential desk: dependency-free Vercel functions deployed as the `insurwreck-desk` project. Base URL: `https://insurwreck-desk.preview.plumhq.com`.
- `site/` — the public attendee event site, deployed as the separate `insurwreck-4` project at `https://insurwreck-4.preview.plumhq.com` (`/` orientation walkthrough — the default landing spot — `/landing` attendee page, both behind Plum-only Google sign-in; `/concept` brand exploration). `site/DESIGN.md` is the source of truth for its visual system and the copy voice used across event communication.
- `desk/schema.sql` — source of truth for the Supabase credential-store schema (project `insurwreck-desk`, ref `mlbnpqoderetgzvjgeam`).

## Desk endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/otp` | email allowlist | Send a six-digit code via Resend (10 min TTL) |
| `POST /api/verify` | email + code | Consume the code, upsert the participant, return a 24 h session token |
| `POST /api/provision` | Bearer session, or `x-admin-key` + `{"email"}` to repair on a participant's behalf | Update registration, mint or repair credentials, return the bundle |
| `GET /api/roster` | `x-admin-key` | Organizer view: participants, idea briefs, issued credentials |
| `GET /api/google-callbacks` | `x-admin-key` | Paste-ready list of Supabase callback URLs for the Google OAuth client |
| `POST /api/google-callbacks` | `x-admin-key` | Mark all issued callbacks as registered in the console |

Live minting today, per registrant: a Vercel project on the Insurwreck team plus a personal access token, a dedicated Supabase project with its keys, a Resend sending-only key, and Google sign-in configured on the participant's own Supabase project. Incomplete entries repair themselves on the next provision call. Pre-provisioned by organizers via the `credentials` table: n8n and AgentMail.

## Google sign-in

Participant apps get Plum Workspace login restricted to `@plumhq.com`, and never handle OAuth credentials — the desk writes the client ID and secret straight into each participant's Supabase auth config, so the secret lives only in the desk environment.

Three enforcement layers: the OAuth consent screen is **Internal** to the plumhq.com Workspace org (the real lock, and it avoids Google verification), `hd=plumhq.com` filters the account chooser, and an `insurwreck_restrict_signup_domain` before-user-created hook inside each participant's database rejects any other domain.

The one manual step: Google exposes no API for an OAuth client's authorized redirect URIs, so each participant's `https://<ref>.supabase.co/auth/v1/callback` must be pasted into the console by hand. Run `GET /api/google-callbacks` for the list, paste it, then `POST /api/google-callbacks` to clear the `google_console_registration` pending part. Until that happens the participant's sign-in button fails with `redirect_uri_mismatch` — everything else about their setup is ready. Cap is ~100 redirect URIs per client, so headcount is not a constraint.

## Dev loop (organizers)

Test the plugin from your local checkout without pushing:

```
/plugin marketplace add /path/to/insurwreck-kit
/plugin install insurwreck@insurwreck-kit
```

Edit command files, then `/insurwreck:update` (or `/plugin marketplace update insurwreck-kit` + reinstall) and restart the session to pick up command changes. `/insurwreck:uninstall` removes everything for a clean retry.

**Both projects deploy on push to `main` — never run `vercel deploy`.** This repo feeds two git-connected Vercel projects: `insurwreck-desk` (Root Directory `desk`) and `insurwreck-4` (Root Directory `site`). `git pull --rebase && git push` is the deploy. Each `vercel.json` carries an `ignoreCommand` so a desk-only commit doesn't redeploy the public event site, and vice versa. A manual deploy uploads your local tree over everyone else's work and silently removes endpoints you don't have locally; it caused a brief production outage on 2026-07-30. Check what shipped with `vercel ls insurwreck-desk --scope plum`. Full rules for contributors are in [AGENTS.md](AGENTS.md).

Environment variables are documented in `desk/.env.example` — the credential store (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), mail (`RESEND_API_KEY`, `RESEND_FROM`), minting (`VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_USER_TOKEN`, `SUPABASE_MGMT_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_REGION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROJECT_ID`), access control (`ADMIN_KEY`, `ALLOWED_DOMAIN`, `ALLOWED_EMAILS`), and two that change what participants get: `OPENAI_API_KEY` enables embeddings at `/api/llm/openai/v1/embeddings` for participants holding an `openai` credentials row - that path only, and no key reaches a laptop - and `INSURWRECK_APP_DOMAIN` gives each project `<name>.insurwreck.com`, which needs a **DNS-only** wildcard CNAME to `cname.vercel-dns.com` first; proxied DNS fails TLS to the origin with a 525.

### Masked on the way out

`list_claims` and `get_claim` on the same MCP server read the Plum base API rather than Metabase, so they keep working through a stats2 outage and stop working if `PLUM_API_TOKEN` is unset. Two things make them different from a published slice.

A slice is frozen SQL an organizer read line by line, so its PII posture is settled at publish time. The claims API is not: `ClaimSerializer` upstream is `fields = '__all__'`, so a column added to the Claim model tomorrow lands in our output the same day. Masking therefore works by shape, not by a list — anything whose key names a person, or whose value looks like an email address or a phone number, is replaced, with a short exception table for the things that only look like PII (organisation and hospital names, filenames). An unknown key holding a PII-shaped value is masked without anyone having listed it. `desk/api/mask.test.mjs` is the check, and its last case is exactly that.

**Bank and government-ID fields are dropped rather than masked**, because none is a name, a phone number or an email and no pattern above would have caught them: `userInputFields` carries `panCard`, `bankDetailsAccountNo` and `bankDetailsIFSC` — null on a cashless claim, filled in on any reimbursement where the member typed their account details in to get paid. Postal addresses, pin codes and `userIPAddress` go the same way.

**Signed object-store URLs are the one deliberate exception, and they are returned whole.** `documents[].url` and `previewUrl` arrive as `storage.googleapis.com` links carrying `X-Goog-Signature` and a 24-hour expiry, and whoever holds one downloads the member's actual discharge summary, bills or Aadhaar scan — a larger disclosure than any name in the response, under a key called `url`. They are returned anyway because the documents are the point: `doc_parse` is the most-declared capability across the ideas on the board, and a claims assistant that cannot open the claim's documents is not one. They are also returned **unscrubbed**, which is a separate decision from returning them: the object path is inside what the signature covers, so rewriting a member's name out of `RAJESH_KUMAR_discharge.pdf` produces a URL that looks correct and 403s — worse than either masking it or removing it. The exception is scoped by the signature parameter, so a name in an *unsigned* URL is still scrubbed; `mask.test.mjs` asserts both halves.

Replacements are stable: the same person reads the same token in every field of every call, so participants can still group, count and dedupe by member without ever seeing who it is. Names are also removed from free text and filenames — `RAJESH_KUMAR_discharge.pdf` is the ordinary case, and masking `memberName` while shipping that filename would be theatre. `memberId` is deliberately **not** masked; it is the filter key.

One project may see real email addresses. That is a per-participant `unmask_email` flag (`/api/admin` `set_unmask_email`), resolved in one function so it can move to idea-to-token mapping when that ships, and it relaxes email only — names and phone numbers stay masked for everyone.

**The warehouse slices mask on the same terms.** `iw_claims_base` and `iw_lives_base` are published unmasked and carry the same people the claims API does, so without this a participant reads through `run_dataset` the member `get_claim` just pseudonymised. Same masker, same salt, one pseudonym per person across both halves of the server. Bank and government-ID columns, postal addresses and pin codes are dropped here too, and named in `dropped_columns` rather than silently vanishing. Two rules, not one: a `bank_account_no` begins with `bank`, so the institution carve-out that keeps `org_name` and `hospital_name` readable would have shielded exactly the field it must not — account numbers, IFSC, PAN and Aadhaar therefore drop unconditionally, and only *locations* get the institution exemption, since an address genuinely can belong to a hospital. `hospital_lookup`'s own unscoped address columns are exempt by name, because searching for a hospital by PIN is the entire point of that slice. Signed URLs pass through whole, on the same terms and for the same reason as above. Six paths return warehouse rows and all six go through it: `run_dataset` live and its `slice_cache` fallback, `describe_dataset`'s sample rows, `query_warehouse`, and `/api/data/<id>.csv` and `.json` — the last being the widest exit in the desk at 2000 rows straight to a file, which declares what it masked in `x-insurwreck-masked` because a CSV on disk carries nowhere else to say it.

Tabular data needs its own masker rather than the claims one pointed at cells, for two reasons that both bite. **Identifiers.** A ten-digit numeric `member_id` beginning 6-9 is byte-for-byte a mobile number, and no regex can separate them; scrubbing an id column rewrites the join key as `phone_<hash>` and every slice silently stops joining to every other slice, and to `list_claims`. Identifier columns are therefore exempt from scrubbing altogether, not merely from key matching, and the response advertises which ones in `join_keys`. **Column naming.** The claims carve-out for institutions is anchored and spelled out (`^organisation`), which is right for camelCase JSON from Django and wrong for snake_case card columns — `org_name` misses it and a real org gets masked as a person, against the whole point of these slices. A person-word anywhere in the column beats an institution prefix, so `policy_holder_name` is a person while `plan_name` is not, and a PII-shaped column of unrecognised shape is masked rather than passed: over-masking a hospital switchboard costs a phone number, under-masking a member costs their privacy. `desk/api/mask-rows.test.mjs` and `desk/api/mask-paths.test.mjs` are the checks — the second drives all six paths and asserts the join key survives every one.

## Security posture

- OTP codes and session tokens are stored hashed (SHA-256); codes expire in 10 minutes, sessions in 24 hours.
- Email allowlist: `@plumhq.com` plus an explicit organizer-managed exception list.
- All Supabase tables run RLS with no policies — only the desk's service role can touch them.
- Minted keys are minimum-scope (Resend: sending only). Everything gets revoked after the event.
- `debug_code` echo on `/api/otp` requires `ADMIN_KEY` and exists for the test phase only.
- Claims responses are masked server-side in the desk, not by a hook — hooks fail open, and this one runs before anything reaches a participant's machine.
- Outbound claims calls are GET-only, asserted in `guardRead` at the single place every request passes through. The claims viewset upstream accepts `put`, `patch`, `post` and `delete` on the same paths we read from, and the desk's credential is an org-wide service token — so the guard is there to keep a later edit honest, not because a participant can reach a write today.
