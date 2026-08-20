---
description: Start Insurwreck 4.0 onboarding — intro, registration, email verification, and credential setup
---

You are running Insurwreck 4.0 onboarding for a Plum Leadership Hackathon participant. Follow the steps below in order. Be warm, brisk, and concrete. Never dump raw API responses on the participant unless a step fails and they need the detail. Never print session tokens.

The credential desk base URL is `https://insurwreck-desk.preview.plumhq.com` (call it `$DESK` below).

## Step 1 — The intro

Run this first, before saying anything else:

```
iw-intro --plain
```

It prints the Insurwreck wordmark, the event line and the tagline.

**Then reproduce that output inside a fenced code block as the first thing in your reply.**
Claude Code truncates long tool output to a few lines with a "+5 lines" fold, so a
wordmark shown only as tool output arrives sliced in half. Copy it character for
character — do not re-draw it, do not fix its spacing, and do not put a heading above it.

If `iw-intro` is not found, carry on without it rather than improvising ASCII art — the
participant loses nothing important.

Then, in your own words and no more than two lines: wish them well, and say setup takes about three minutes and starts with three questions. Something in the spirit of *"All the best — you're about to have a working build environment. Let's start with your name."* Warm, not gushing, and do not copy that sentence verbatim.

## Step 2 — Registration

Ask conversationally, one at a time (wait for each answer before asking the next):

1. Their full name.
2. Their work email. It should be an `@plumhq.com` address — if it isn't, mention that only Plum addresses (plus a small organizer allowlist) can be verified, and let them correct it or proceed to let the desk decide.
3. Their idea brief: two sentences on the recurring problem they want to attack. If they don't have one yet, that's fine — capture "still exploring" and point them to https://insurwreck-4.preview.plumhq.com/#ideas for later.
4. A short name for their site. Tell them plainly what it is for: **this becomes the web address they demo on**, `<name>.insurwreck.com`. Ask for one or two words about the project, not about them — `claims-copilot`, not `abel-p`. Lowercase, letters, numbers and hyphens; anything else gets folded to a hyphen.

   If they don't have a name yet, or ask you to pick, don't invent one and don't
   stall - say they'll get a working address either way and can be given a nicer
   one later, then move on. Leave it out of the call below rather than sending a
   guess: a guess becomes a URL and URLs are read out loud on Friday.

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
  -d '{"name":"<name>","idea_brief":"<brief>","site_name":"<short-name>","agent":"claude-code"}'
```

Omit `site_name` entirely if they didn't give one - an empty string is not the
same thing, and sending one would replace a name they already chose on an earlier
run. Their address falls back to their project slug, which always works.

Once it returns, tell them their address: it's `services.vercel.app_url`. If that
field is absent the domain isn't wired yet on the desk - say nothing about it
rather than promising a URL that won't resolve.

The response is their credential bundle: `{ participant, services: {...}, pending: [...] }`. A service entry with `"incomplete": true` is partially provisioned — its `pending_parts` lists what's still coming (for example Supabase `api_keys` that need another minute). Re-running this same call later repairs incomplete entries; it never duplicates anything.

Store it:

1. `mkdir -p ~/.insurwreck && chmod 700 ~/.insurwreck`
2. Write the full JSON response to `~/.insurwreck/credentials.json` and `chmod 600` it.
3. If the current directory is a git repository, make sure `.insurwreck*` and `.env*` are covered by `.gitignore` (append them if missing).

### Step 4b — Switch on the data connection

Three of the MCP servers resolve a `${TOKEN}` placeholder at Claude Code startup, and
those tokens only exist once Step 4 has run. Hand them over by running:

```
iw-connect
```

That is the whole step. It reads the bundle you just stored, merges `INSURWRECK_TOKEN`
(read-only Plum data slices), `N8N_TOKEN` (workflows), `KULA_API_KEY` (recruiting data)
the three `ZENDESK_*` values (support tickets)
and the three `CLEVERTAP_*` values (engagement analytics) into `~/.claude/settings.json` without disturbing anything already there, skips whatever
isn't issued yet, and checks the data server actually accepts the token. It is safe to
run again.

**Do not edit `~/.claude/settings.json` yourself.** Hand-editing it is how this step gets
skipped or half-done, and a missing `INSURWRECK_TOKEN` looks exactly like the data server
being broken. Show the participant `iw-connect`'s output as-is; it never prints a token.

If it reports the data server rejected the token, stop and tell them to find an organizer -
re-running will not fix that.

`iw-connect` will end by telling them to quit and restart. **Do not act on that yet** - the
restart is the last thing in this whole flow, and restarting here would drop them out of
onboarding. You will instruct them at the end, in Step 7.

After the restart, five of the six MCP servers work with no further action:
`insurwreck-data`, `n8n`, `kula`, `zendesk` and `clevertap`. Only Salesforce needs the participant to log in as
themselves, because it acts with that person's own permissions - point them at
`/insurwreck:connect` and don't walk them through it here.

Say plainly: the data they get is a **de-identified snapshot** of Plum data — no member
names, ages banded, free-text diagnosis and ticket bodies removed. It is still
confidential: no screenshots into Slack, nothing on a slide.

## Step 5 — Install the CLIs

Their infrastructure is ready; now make sure the tools are on this machine. Tell the participant you're checking their tooling, then:

1. Run `vercel --version`. If missing, install it: `npm install -g vercel@latest` (if npm is unavailable, use `brew install vercel-cli` on macOS).
2. Run `supabase --version`. If missing, install it: `brew install supabase/tap/supabase` on macOS, `scoop install supabase` on Windows. If neither package manager exists, note that `npx supabase` works per-project and continue.

Confirm both versions after installing. If an install fails, do not block onboarding — show the error, link the official install docs, and move on.

No CLI logins are needed, and never run `vercel login` or `supabase login`:

- Vercel authenticates with the personal token from their bundle — every command takes `--token <token>` (their bundle's `note` field has the exact link + deploy command).
- The Supabase CLI reaches their project without login through the direct database URL: `postgresql://postgres:<db_password>@db.<project_ref>.supabase.co:5432/postgres` (both values are in their bundle).

## Step 6 — Summary and first build step

Show a compact status table for the seven services - Vercel, Supabase, Anthropic, Resend, AgentMail, n8n, Google sign-in. A service present in `services` is **Ready**; one marked `incomplete` is **Almost ready** (name its `pending_parts` and say `/insurwreck:status` can refresh it later); one in `pending` is **Pending - the AI pod is provisioning it**. For ready services, mention in one line what the credential is for:

- Vercel — their own project on the Insurwreck team plus a personal access token. Deploy with `iw-deploy`, which handles the token for them.
- Supabase — their own dedicated project (URL, anon key, service_role key, DB password).
- Anthropic — model access for the app they build, metered against a per-person budget. It plugs into the Anthropic SDK by setting `baseURL` to `api_base`; it is not a normal Anthropic key and won't work against `api.anthropic.com`.
- Resend — sending-only key on the shared hackathon domain.
- AgentMail - their own agent inbox with a real address that can send and receive.
- Google sign-in - Plum Workspace login for their app, restricted to `@plumhq.com`; run `/insurwreck:add-google-auth` when they want it wired in.

Also mention the two things they get for free: `iw-doctor` checks their whole setup and
explains anything broken in plain English, and the `insurwreck-data` MCP server gives
them read-only Plum data slices - tell them to just ask for what they want, e.g.
"show me claims by status".

Then read their idea brief back to them and propose ONE concrete first build step tailored to it:

- Brief involves email parsing, inbound mail, or follow-ups → suggest starting from the AgentMail inbox plus an n8n trigger once those are ready.
- Brief involves a dashboard, report, or brief → suggest scaffolding the app first and deploying a hello-world to Vercel.
- Brief involves classification, routing, or reconciliation → suggest defining the Supabase table that holds the queue first.
- Still exploring → suggest browsing the idea decks on the event page and coming back with `/insurwreck:status`.

Then the housekeeping commands, exactly:

- `/insurwreck:status` — show this summary again
- `/insurwreck:add-google-auth` — add Plum Workspace sign-in to your app
- `/insurwreck:update` — pull the newest kit

## Step 7 — The restart, and nothing after it

This is the last thing you say. Everything above is set up; the Plum data connection is
written but not yet loaded, because Claude Code reads it once at startup and this session
started before it existed.

Make it the final, unmissable instruction. Say it in your own words, but it must carry
all three of these:

1. **What to do** — quit Claude Code and start it again, with the same command the
   installer gave them (`claude --permission-mode auto` from their project folder).
2. **Why it matters** — until they do, asking for Plum data will fail, and it will look
   like the data server is broken rather than like a pending restart.
3. **How to check** — after restarting, ask for something real, e.g. "show me claims by
   status". If it doesn't work, `iw-doctor` will say which of the three states they're in
   and what to do.

Do not bury this under other text, do not pair it with a new suggestion, and do not end on
anything else. A participant who misses this line is the single most likely failure in the
whole onboarding - it has already happened once in testing.
