---
description: Show your Insurwreck 4.0 registration and credential status
---

Show the participant their current Insurwreck 4.0 setup state.

1. Read `~/.insurwreck/credentials.json`. If it does not exist, tell them they haven't onboarded yet and to run `/insurwreck:start`, then stop.
2. From the file, show:
   - Who they're registered as (name, email) and their idea brief.
   - A status table for Vercel, Supabase, n8n, Resend, AgentMail, Google sign-in: **Ready** if present under `services`, **Almost ready** if the entry has `"incomplete": true` (name its `pending_parts`), **Pending** if listed under `pending`.
3. If anything is pending, offer to re-fetch the bundle: ask for confirmation, then re-run onboarding Steps 3–4 from `/insurwreck:start` (a fresh OTP is required — the desk does not persist sessions on disk). If everything is ready, suggest the next build step based on their idea brief instead.

Never print API keys or tokens in full — show the service name and the last 4 characters at most.
