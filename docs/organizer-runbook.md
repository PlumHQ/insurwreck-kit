# Organizer runbook — Insurwreck 4.0

Base URL for everything below: `$DESK` = `https://insurwreck-desk.preview.plumhq.com`. You'll need `ADMIN_KEY` (from the desk's Vercel project env vars) — export it once:

```
export ADMIN_KEY=<the desk's ADMIN_KEY>
```

## Morning pre-flight

Run through this before doors open:

1. **Desk is up and your key works:**
   ```
   curl -s $DESK/api/roster -H "x-admin-key: $ADMIN_KEY"
   ```
   Expect `{"participants":[...],"credentials":[...]}`. A 401 means `ADMIN_KEY` is wrong; anything else means the desk itself is down — check the Vercel deployment first.

2. **Vercel personal-token minting is actually wired up.** `mintVercel` needs `VERCEL_USER_TOKEN` (a personal-scope PAT, distinct from the team-scoped `VERCEL_API_TOKEN`). Without it, every participant's Vercel token stays `pending` forever and `iw-deploy` won't work for anyone. Confirm it's set in the desk's env before the event, not after the first complaint.

3. **Supabase minting works.** Needs `SUPABASE_MGMT_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_REGION`. Do one real dry-run provision (see below) and confirm `services.supabase.service_role_key` actually comes back, not just `project_ref` with `incomplete: true`.

4. **Email allowlist covers everyone.** `ALLOWED_DOMAIN=plumhq.com` covers Plum staff; any external guest needs their address added to the comma-separated `ALLOWED_EMAILS`. Do this before the event — participants can't self-add.

5. **Resend sending domain is healthy** (not flagged/throttled) — send yourself a test OTP and confirm it lands, not just that the API call returns `ok: true`.

6. **LLM budget is sane.** `LLM_BUDGET_USD` (default $15/participant) is enforced hard — at spend, `/api/llm` returns 429 and the participant is stuck until you raise it. Decide the number for the day now.

7. **Do one full dry run** of `/insurwreck:start` yourself end to end, on a test email, before participants arrive.

8. **Have this runbook and the participant cheatsheet pinned** somewhere participants can find without asking (Slack channel bookmark, printed sheet).

## Unsticking one participant

Use this when someone's stuck mid-onboarding — didn't get the OTP email, lost their code, or their Claude session died before they finished. You do the verify/provision steps *for* them, on their behalf, then hand back what they need.

**1. Request a code, using your admin key so the code comes back in the response** (no inbox access needed):

```
curl -s -X POST $DESK/api/otp \
  -H "Content-Type: application/json" \
  -H "x-admin-key: $ADMIN_KEY" \
  -d '{"email":"<their email>"}'
```

Response includes `"debug_code": "123456"` because the request carries `x-admin-key` (see `desk/api/otp.js` — this echo only exists because `isAdmin(req)` is true; it's off for everyone else).

**2. Verify with that code** — this step does *not* need the admin key, it's the normal participant flow:

```
curl -s -X POST $DESK/api/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"<their email>","code":"<debug_code>"}'
```

Returns `{"ok":true,"token":"...","expires_at":"..."}` — a 24-hour session token for *them*.

**3. Provision on their behalf, using that session token as the Bearer:**

```
curl -s --max-time 280 -X POST $DESK/api/provision \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<their name>","idea_brief":"<their brief>","agent":"claude-code"}'
```

Returns their full credential bundle (`participant`, `services`, `pending`).

**4. Hand it back, don't keep it.** Paste the JSON directly to the participant (DM, not a shared channel) so *they* save it to `~/.insurwreck/credentials.json` on their own machine. Don't keep a copy of someone else's `service_role_key` / Vercel token in your own notes or terminal history longer than it takes to paste it over — clear your scrollback after.

If a service comes back `incomplete: true`, re-running step 3 later repairs it (it's idempotent — never mints a duplicate).

## Post-event revocation

**The honest state of this today: `credentials.revoked_at` exists in the schema, but almost no code path enforces it, and no endpoint sets it.** Revoking is a manual SQL step, and it does *different* things depending on the service — read this before running anything.

Run in the Supabase SQL editor on the **`insurwreck-desk`** project (the credential store, not a participant's own project):

```sql
update public.credentials
set revoked_at = now()
where revoked_at is null;
```

What this actually accomplishes, per service (traced from `desk/api/`):

- **`anthropic` — this one is real and immediate.** Both `/api/llm/[...path].js` and `/api/mcp.js` look up the caller's row with `revoked_at=is.null` on every single request. The instant you set `revoked_at`, that participant's Claude API access *and* their Plum-warehouse MCP access both stop working. This is the one row where the SQL alone is a genuine kill switch.
- **`vercel`, `supabase`, `resend` — the SQL does nothing to the live credential.** Nothing reads `revoked_at` for these at request time; the participant's Vercel token, Supabase keys, and Resend key keep working at the provider regardless of what the database says. To actually cut them off:
  - **Vercel**: delete the participant's personal access token (its id is in their bundle as `services.vercel.token_id`) — via the Vercel dashboard (Account Settings → Tokens) or `DELETE /v2/user/tokens/{tokenId}` with the master `VERCEL_USER_TOKEN`. Optionally also delete/transfer their project (`services.vercel.project_id`).
  - **Supabase**: pause or delete their dedicated project (`services.supabase.project_ref`) via the Supabase dashboard or Management API — this kills every key on that project in one action, which is cleaner than trying to revoke individual keys.
  - **Resend**: delete the minted key (`services.resend.key_id`) from the Resend dashboard or API.
- **`agentmail` — there is no per-participant key to revoke.** Every participant's `services.agentmail.api_key` is the *same* shared org key (there's no per-inbox key in AgentMail's API — see `desk/.env.example`). You can delete an individual's inbox (`services.agentmail.inbox_id`) to shut down their mailbox, but the key itself stays live for everyone until you rotate `AGENTMAIL_API_KEY` for the whole event.

**One side-effect worth knowing:** the `credentials` table has a unique constraint on `(participant_email, service)`. Once a row's `revoked_at` is set, `/api/provision` no longer sees it (it filters `revoked_at is null`) and will try to mint a *new* row for that service on the next provision call — which then hits the unique constraint and fails silently (logged server-side, service just shows as `pending` in the response). In practice this means: revoke after the event is truly over, not mid-event if there's any chance someone still needs a repair-provision call.

If in doubt, the cleanest full stop is: revoke `anthropic` via SQL (kills model + warehouse access immediately), then physically delete/rotate the Vercel token, Supabase project, and Resend key per participant, and rotate the shared AgentMail key once for everyone.
