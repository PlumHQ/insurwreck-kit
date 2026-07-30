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

Other commands: `/insurwreck:status`, `/insurwreck:add-google-auth`, `/insurwreck:update`, `/insurwreck:uninstall`.

## Layout

- `.claude-plugin/marketplace.json` — makes this repo installable as a Claude Code plugin marketplace.
- `plugin/` — the `insurwreck` plugin (commands only, no secrets, no code execution beyond curl to the desk).
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

Desk deploys from `desk/`: `vercel deploy --prod`. Environment variables are documented in `desk/.env.example` — the credential store (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), mail (`RESEND_API_KEY`, `RESEND_FROM`), minting (`VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_USER_TOKEN`, `SUPABASE_MGMT_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_REGION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROJECT_ID`), and access control (`ADMIN_KEY`, `ALLOWED_DOMAIN`, `ALLOWED_EMAILS`).

## Security posture

- OTP codes and session tokens are stored hashed (SHA-256); codes expire in 10 minutes, sessions in 24 hours.
- Email allowlist: `@plumhq.com` plus an explicit organizer-managed exception list.
- All Supabase tables run RLS with no policies — only the desk's service role can touch them.
- Minted keys are minimum-scope (Resend: sending only). Everything gets revoked after the event.
- `debug_code` echo on `/api/otp` requires `ADMIN_KEY` and exists for the test phase only.
