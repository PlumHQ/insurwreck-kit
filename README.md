# insurwreck-kit

The Insurwreck 4.0 build kit: a Claude Code plugin that onboards Leadership Hackathon participants, plus the credential desk API that verifies them and delivers their per-service credentials.

Private during the test phase; goes public before the event. **This repo must never contain secrets** — all master keys live in the desk's Vercel environment.

## For participants

Inside Claude Code:

```
/plugin marketplace add PlumHQ/insurwreck-kit
/plugin install insurwreck@insurwreck-kit
/insurwreck:start
```

`/insurwreck:start` introduces the event, registers you (name, email, idea brief), verifies your email with a six-digit code, and writes your credential bundle to `~/.insurwreck/credentials.json`.

Other commands: `/insurwreck:status`, `/insurwreck:connect`, `/insurwreck:keka-connect`, `/insurwreck:add-google-auth`, `/insurwreck:update`, `/insurwreck:uninstall`.

## Bundled MCP servers

All five start automatically when the plugin installs — they are declared in `plugin/.mcp.json`, so there is no separate install step.

| Server | Package | Official? | Auth | Scoped to the individual? |
|---|---|---|---|---|
| `salesforce` | [`@salesforce/mcp`](https://github.com/salesforcecli/mcp) (Apache-2.0) | Yes — Salesforce DX MCP Server | `sf org login web` — browser OAuth, no password reaches us | **Yes** — acts as their user, with their profile, permission sets and sharing rules |
| `kula` | [`@kula-ai/mcp-server`](https://github.com/kula-ai/kula-mcp-server) (MIT) | Yes — Kula's own server | `KULA_API_KEY`, one shared organizer key, delivered in the bundle | **No** — read-only, enforced by a hook; see below |
| `keka` | ours — `desk/api/keka-mcp.js` over HTTP | No — Keka publishes no MCP server | `INSURWRECK_TOKEN` + one-time Keka OAuth per participant | **Yes** — Keka enforces their permissions |
| `insurwreck-data` | ours — `desk/api/mcp.js` | — | `INSURWRECK_TOKEN` | Allowlisted warehouse slices, same for everyone |
| `n8n` | organizer-hosted | — | `N8N_TOKEN` | Shared workspace |

`/insurwreck:start` writes `INSURWRECK_TOKEN`, `N8N_TOKEN` and `KULA_API_KEY` from the bundle into `~/.claude/settings.json`, so after one restart `insurwreck-data`, `n8n` and `kula` are live with no further action. Only the two servers that act with the participant's own identity need a login: Salesforce via `/insurwreck:connect`, Keka via `/insurwreck:keka-connect`. A server whose credential is missing fails to connect and the others keep working.

Every server here is always on, so it costs context on every turn for everyone. A participant whose idea touches none of them can drop one with `claude mcp remove <name>`.

### Salesforce: scoped to the individual

`sf org login web` opens Salesforce's own login page — SSO and MFA both work — and the session then acts as that person, with their profile, permission sets and sharing rules. Anything they can't see in the Salesforce UI, the agent can't see either. The server ships read-only: `--toolsets data --tools run_soql_query`, and SOQL cannot write. Default to the sandbox.

### Kula: shipped, shared, and read-only by force

Kula works, and deliberately not the way Salesforce and Keka do. [Kula's authentication docs](https://developers.kula.ai/docs/api-guides/authentication) support bearer API tokens and nothing else — no OAuth flow, no authorization endpoint, no SSO, no per-user keys. One organizer-issued key therefore goes to every participant, and everyone sees the same recruiting pipeline. `mintKula` in `desk/api/_minters.js` delivers it in the bundle and leaves the service `pending` while `KULA_API_KEY` is unset on the desk.

The key issued for this event is the **Application API** type — "full access" in Kula's own docs — and Kula offers no read-only key type. So access is narrowed on our side instead: `plugin/hooks/scripts/block-kula-writes.sh` is a `PreToolUse` hook on `mcp__kula__.*` that allows `list_*`, `get_*`, `search_*` and `autocomplete_*` and denies everything else, with a message telling the participant to write to their own Supabase instead.

Two deliberate choices in that hook:

- **No override.** There is no env var to re-enable writes, and `test-block-kula-writes.sh` asserts that one can't be introduced by accident. Twenty-five agents sharing write access to a live hiring pipeline is not a risk worth an escape hatch.
- **Allow by verb, not deny by name.** Blocking the 11 known write tools would leave a gap the day `@kula-ai/mcp-server` ships a twelfth. Allowing only the four read prefixes means a new write tool is blocked from the moment it exists.

The hook fails open on malformed input — a broken hook must not take Kula down mid-build — so it is a guardrail against an agent doing something careless, not a security boundary against a determined participant. Note what that means concretely: the shared full-access key is written to `~/.claude/settings.json` on ~25 machines, so anyone who wants to can bypass the hook with their own `claude mcp add kula`. The real boundary remains the key's own permissions. Closing that properly means proxying Kula through the desk the way Keka is, exposing read tools only, so the key never leaves Vercel — worth doing if this outlives the hackathon.

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
| `POST /api/keka` | Bearer `iwk-` token | Start Keka per-user OAuth; returns an `authorize_url` with a single-use 10 min state |
| `GET /api/keka-callback` | OAuth state | Keka's redirect target: consumes the state, swaps the code for tokens |
| `POST /api/keka-mcp` | Bearer `iwk-` token | MCP server exposing the caller's own Keka data |

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

Desk deploys from `desk/`: `vercel deploy --prod`. Environment variables are documented in `desk/.env.example` — the credential store (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), mail (`RESEND_API_KEY`, `RESEND_FROM`), minting (`VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_USER_TOKEN`, `SUPABASE_MGMT_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_REGION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROJECT_ID`), and access control (`ADMIN_KEY`, `ALLOWED_DOMAIN`, `ALLOWED_EMAILS`).

## Security posture

- OTP codes and session tokens are stored hashed (SHA-256); codes expire in 10 minutes, sessions in 24 hours.
- Email allowlist: `@plumhq.com` plus an explicit organizer-managed exception list.
- All Supabase tables run RLS with no policies — only the desk's service role can touch them.
- Minted keys are minimum-scope (Resend: sending only). Everything gets revoked after the event.
- `debug_code` echo on `/api/otp` requires `ADMIN_KEY` and exists for the test phase only.
