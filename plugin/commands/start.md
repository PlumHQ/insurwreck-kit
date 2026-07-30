---
description: Start Insurwreck 4.0 onboarding — intro, registration, email verification, and credential setup
---

You are running Insurwreck 4.0 onboarding for a Plum Leadership Hackathon participant. Follow the steps below in order. Be warm, brisk, and concrete. Never dump raw API responses on the participant unless a step fails and they need the detail. Never print session tokens.

The credential desk base URL is `https://insurwreck-desk.preview.plumhq.com` (call it `$DESK` below).

## Step 1 — The intro

Print exactly this block, fenced as a code block, before saying anything else:

```
 ___  _  _  ___  _   _  ___ __      __ ___  ___   ___  _  __
|_ _|| \| |/ __|| | | || _ \\ \    / /| _ \| __| / __|| |/ /
 | | | .` |\__ \| |_| ||   / \ \/\/ / |   /| _| | (__ | ' <
|___||_|\_||___/ \___/ |_|_\  \_/\_/  |_|_\|___| \___||_|\_\

        4.0 · LEADERSHIP HACKATHON · 31 JULY 2026 · PLUM

    Bring one real problem. Leave with a working prototype.
```

Then say, in one short sentence of your own, that setup takes about three minutes and starts with three questions.

## Step 2 — Registration

Ask conversationally, one at a time (wait for each answer before asking the next):

1. Their full name.
2. Their work email. It should be an `@plumhq.com` address — if it isn't, mention that only Plum addresses (plus a small organizer allowlist) can be verified, and let them correct it or proceed to let the desk decide.
3. Their idea brief: two sentences on the recurring problem they want to attack. If they don't have one yet, that's fine — capture "still exploring" and point them to https://insurwreck-4.preview.plumhq.com/#ideas for later.

## Step 3 — Verify their email

Request a code (use Bash with curl):

```
curl -s -X POST $DESK/api/otp -H "Content-Type: application/json" -d '{"email":"<email>"}'
```

- On `{"ok":true,...}`: tell them a six-digit code is on its way from `insurwreck@badge.plumhq.com` (check spam the first time), and ask for the code.
- On HTTP 403: the address isn't allowed — ask for their Plum address and retry.
- On any other error: show the `error` field and offer to retry once before suggesting they ping the AI pod.

When they give you the code:

```
curl -s -X POST $DESK/api/verify -H "Content-Type: application/json" -d '{"email":"<email>","code":"<code>"}'
```

- Success returns `{"ok":true,"token":"..."}`. Keep the token for Step 4 and do not display it.
- On `wrong or expired code`: let them retype it, up to 3 attempts total, then offer to send a fresh code (repeat the `/api/otp` call).

## Step 4 — Fetch their credential bundle

Before running this call, tell the participant their personal infrastructure is being created — their own Vercel project and their own Supabase project — and that it takes a minute or two. Then run it with a generous timeout:

```
curl -s --max-time 280 -X POST $DESK/api/provision \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","idea_brief":"<brief>","agent":"claude-code"}'
```

The response is their credential bundle: `{ participant, services: {...}, pending: [...] }`. A service entry with `"incomplete": true` is partially provisioned — its `pending_parts` lists what's still coming (for example Supabase `api_keys` that need another minute). Re-running this same call later repairs incomplete entries; it never duplicates anything.

Store it:

1. `mkdir -p ~/.insurwreck && chmod 700 ~/.insurwreck`
2. Write the full JSON response to `~/.insurwreck/credentials.json` and `chmod 600` it.
3. If the current directory is a git repository, make sure `.insurwreck*` and `.env*` are covered by `.gitignore` (append them if missing).

## Step 5 — Install the CLIs

Their infrastructure is ready; now make sure the tools are on this machine. Tell the participant you're checking their tooling, then:

1. Run `vercel --version`. If missing, install it: `npm install -g vercel@latest` (if npm is unavailable, use `brew install vercel-cli` on macOS).
2. Run `supabase --version`. If missing, install it: `brew install supabase/tap/supabase` on macOS, `scoop install supabase` on Windows. If neither package manager exists, note that `npx supabase` works per-project and continue.

Confirm both versions after installing. If an install fails, do not block onboarding — show the error, link the official install docs, and move on.

No CLI logins are needed, and never run `vercel login` or `supabase login`:

- Vercel authenticates with the personal token from their bundle — every command takes `--token <token>` (their bundle's `note` field has the exact link + deploy command).
- The Supabase CLI reaches their project without login through the direct database URL: `postgresql://postgres:<db_password>@db.<project_ref>.supabase.co:5432/postgres` (both values are in their bundle).

## Step 6 — Summary and first build step

Show a compact status table for the five services — Vercel, Supabase, n8n, Resend, AgentMail. A service present in `services` is **Ready**; one marked `incomplete` is **Almost ready** (name its `pending_parts` and say `/insurwreck:status` can refresh it later); one in `pending` is **Pending — the AI pod is provisioning it**. For ready services, mention in one line what the credential is for:

- Vercel — their own project on the Insurwreck team plus a personal access token; deploys go live with `vercel deploy --token`.
- Supabase — their own dedicated project (URL, anon key, service_role key, DB password).
- Resend — sending-only key on the shared hackathon domain.

Then read their idea brief back to them and propose ONE concrete first build step tailored to it:

- Brief involves email parsing, inbound mail, or follow-ups → suggest starting from the AgentMail inbox plus an n8n trigger once those are ready.
- Brief involves a dashboard, report, or brief → suggest scaffolding the app first and deploying a hello-world to Vercel.
- Brief involves classification, routing, or reconciliation → suggest defining the Supabase table that holds the queue first.
- Still exploring → suggest browsing the idea decks on the event page and coming back with `/insurwreck:status`.

Close with the housekeeping commands, exactly:

- `/insurwreck:status` — show this summary again
- `/insurwreck:update` — pull the newest kit
- `/insurwreck:uninstall` — remove the kit and stored credentials
