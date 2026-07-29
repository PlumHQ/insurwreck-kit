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

Other commands: `/insurwreck:status`, `/insurwreck:update`, `/insurwreck:uninstall`.

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
| `POST /api/provision` | Bearer session | Update registration, mint live credentials (Resend), return the bundle |
| `GET /api/roster` | `x-admin-key` | Organizer view: participants, idea briefs, issued credentials |

Live minting today: Resend sending-only keys. Pre-provisioned by organizers (inserted into the `credentials` table): Vercel, n8n, and for now Supabase and AgentMail.

## Dev loop (organizers)

Test the plugin from your local checkout without pushing:

```
/plugin marketplace add /path/to/insurwreck-kit
/plugin install insurwreck@insurwreck-kit
```

Edit command files, then `/insurwreck:update` (or `/plugin marketplace update insurwreck-kit` + reinstall) and restart the session to pick up command changes. `/insurwreck:uninstall` removes everything for a clean retry.

Desk deploys from `desk/`: `vercel deploy --prod`. Environment variables (set in Vercel, documented in `desk/.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_KEY`, `ALLOWED_DOMAIN`, `ALLOWED_EMAILS`.

## Security posture

- OTP codes and session tokens are stored hashed (SHA-256); codes expire in 10 minutes, sessions in 24 hours.
- Email allowlist: `@plumhq.com` plus an explicit organizer-managed exception list.
- All Supabase tables run RLS with no policies — only the desk's service role can touch them.
- Minted keys are minimum-scope (Resend: sending only). Everything gets revoked after the event.
- `debug_code` echo on `/api/otp` requires `ADMIN_KEY` and exists for the test phase only.
