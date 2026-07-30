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

**On Windows?** Open PowerShell as administrator, run `wsl --install`, restart your laptop, then open "Ubuntu" from the Start menu and paste the same line there. Do this **tonight**, not tomorrow morning - it needs a restart.

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
| `/insurwreck:status` | shows your setup again, and repairs anything that did not finish |
| `/insurwreck:connect` | connects Salesforce or another outside system |
| `/insurwreck:add-google-auth` | adds "Sign in with Google" to your app, Plum accounts only |

Still stuck after `iw-doctor`? Find an organiser. Do not lose twenty minutes to it.

## Bundled MCP servers

All five start automatically when the plugin installs — they are declared in `plugin/.mcp.json`, so there is no separate install step.

| Server | Package | Official? | Auth | Scoped to the individual? |
|---|---|---|---|---|
| `salesforce` | [`@salesforce/mcp`](https://github.com/salesforcecli/mcp) (Apache-2.0) | Yes — Salesforce DX MCP Server | `sf org login web` — browser OAuth, no password reaches us | **Yes** — acts as their user, with their profile, permission sets and sharing rules |
| `kula` | [`@kula-ai/mcp-server`](https://github.com/kula-ai/kula-mcp-server) (MIT) | Yes — Kula's own server | `KULA_API_KEY`, one shared organizer key, delivered in the bundle | **No** — read-only, enforced by a hook; see below |
| `insurwreck-data` | ours — `desk/api/mcp.js` | — | `INSURWRECK_TOKEN` | Allowlisted warehouse slices, same for everyone |
| `n8n` | organizer-hosted | — | `N8N_TOKEN` | Shared workspace |
| `remotion` | [`@remotion/mcp`](https://github.com/remotion-dev/remotion/tree/main/packages/mcp) (MIT) | Yes — Remotion's own | none — unauthenticated, no key | n/a — searches public docs |

Three of the four resolve a `${TOKEN}` placeholder when Claude Code starts, and those tokens do not exist until `/insurwreck:start` has run inside an already-started Claude Code. `/insurwreck:start` closes that gap by running `iw-connect`, which merges `INSURWRECK_TOKEN`, `N8N_TOKEN` and `KULA_API_KEY` from the bundle into `~/.claude/settings.json` without disturbing anything else there, skips whatever is not issued yet, and probes the desk so a rejected token cannot look like a missing one. After one restart `insurwreck-data`, `n8n` and `kula` are live.

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

Run the check with `bash plugin/hooks/scripts/test-block-kula-writes.sh`.

## Layout

- `.claude-plugin/marketplace.json` — makes this repo installable as a Claude Code plugin marketplace.
- `plugin/` — the `insurwreck` plugin (commands only, no secrets, no code execution beyond curl to the desk).
- `plugin/.mcp.json` — MCP servers shipped with the plugin. Keys come from the participant's environment, never this repo.
- `desk/` — the credential desk: dependency-free Vercel functions deployed as the `insurwreck-desk` project. Base URL: `https://insurwreck-desk.preview.plumhq.com`.
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

**The desk deploys on push to `main` — never run `vercel deploy`.** The Vercel project is git-connected (`PlumHQ/insurwreck-kit` → `main` → Root Directory `desk`), so `git pull --rebase && git push` is the deploy. A manual deploy uploads your local tree over everyone else's work and silently removes endpoints you don't have locally; it caused a brief production outage on 2026-07-30. Check what shipped with `vercel ls insurwreck-desk --scope plum`. Full rules for contributors are in [AGENTS.md](AGENTS.md).

Environment variables are documented in `desk/.env.example` — the credential store (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), mail (`RESEND_API_KEY`, `RESEND_FROM`), minting (`VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_USER_TOKEN`, `SUPABASE_MGMT_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_REGION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROJECT_ID`), and access control (`ADMIN_KEY`, `ALLOWED_DOMAIN`, `ALLOWED_EMAILS`).

## Security posture

- OTP codes and session tokens are stored hashed (SHA-256); codes expire in 10 minutes, sessions in 24 hours.
- Email allowlist: `@plumhq.com` plus an explicit organizer-managed exception list.
- All Supabase tables run RLS with no policies — only the desk's service role can touch them.
- Minted keys are minimum-scope (Resend: sending only). Everything gets revoked after the event.
- `debug_code` echo on `/api/otp` requires `ADMIN_KEY` and exists for the test phase only.
