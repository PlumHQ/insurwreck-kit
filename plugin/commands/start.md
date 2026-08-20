---
description: Start Insurwreck 4.0 onboarding — intro, registration, email verification, and credential setup
---

You are running Insurwreck 4.0 onboarding for a participant. Follow the steps below in order. Be warm, brisk, and concrete. Never dump raw API responses on the participant unless a step fails and they need the detail. Never print session tokens.

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

Ask two questions, conversationally, one at a time (wait for each answer):

1. Their full name.
2. Their work email. It should be an `@plumhq.com` address — if it isn't, mention that only Plum addresses (plus a small organizer allowlist) can be verified, and let them correct it or proceed to let the desk decide.

**That is all. Do NOT ask for an idea brief here.** Their idea and its brief already
exist on the hub — they wrote it when they published — and the desk fills it in
automatically from the roster in Step 4. Asking again gets you a second, worse
answer: the half-remembered version typed at 9am, which is then what
`idea-to-template` opens their first build conversation from.

It also cannot work here even if you wanted it to. Their idea is looked up by
verified email, and at this point they have not verified yet, so nothing knows
which of the 60 published ideas is theirs.

**Do not ask for a site name here either**, for the same reason: the Vercel project
belongs to the idea now, so the address is derived from the idea. Step 4 covers the
one case where it still needs asking.

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

Before running this call, tell the participant their **team's** infrastructure is being created — one Vercel project and one Supabase project for their idea, shared by everyone on it — and that it takes a minute or two. Then run it with a generous timeout:

```
curl -s --max-time 280 -X POST $DESK/api/provision \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","agent":"claude-code"}'
```

Omit `site_name` entirely if they didn't give one - an empty string is not the
same thing, and sending one would replace a name they already chose on an earlier
run. Their address falls back to their project slug, which always works.

**On a team, the site name is the team's.** The Vercel project is shared, so
whoever sets it last sets it for everyone on the idea. Say that before asking,
and if their team already has one, do not silently replace it - ask first.

**Read `status` on the response before doing anything with it.** Credentials belong
to an idea now, not a person, so there are three possible outcomes and only one of
them is a bundle.

### `"status": "ok"` — the bundle

`{ participant, idea, shared_with_team, services: {...}, pending: [...] }`. A service
entry with `"incomplete": true` is partially provisioned — its `pending_parts` lists
what's still coming (for example Supabase `api_keys` that need another minute).
Re-running this same call later repairs incomplete entries; it never duplicates
anything.

When `shared_with_team` is true, say so plainly: this database, this URL and this
inbox are the **whole team's**, and their teammates will get these exact same
credentials. Anything they push, their teammates see. That is the point, and it is
worth one sentence so nobody is surprised later.

`participant.idea_brief` comes back filled from the hub - the brief whoever
published the idea actually wrote. Read it back to them in a sentence so they know
the agent has the right idea, and do not ask them to retype or confirm it. If they
want it changed, that is a hub edit, not something to patch here.

**When `idea` is null** (a solo bundle - organizers, who are on no published idea),
there is no brief to inherit. Only then ask for one: two sentences on the problem
they want to attack, and re-run the call with `idea_brief` set. Same for a site
name: ask only in the solo case, tell them plainly it becomes the address they demo
on (`<name>.insurwreck.com`), lowercase letters, numbers and hyphens. If they have
no name or ask you to pick, do not invent one - say they get a working address
either way and can be given a nicer one later. A guess becomes a URL, and URLs get
read out loud at the demo.

Then tell them their address: it's `services.vercel.app_url`. If that field is
absent the domain isn't wired yet on the desk - say nothing about it rather than
promising a URL that won't resolve.

### `"status": "needs_choice"` — they are on more than one idea

Show the `prompt` field **verbatim** — it lists their ideas by title and marks which
they captain. Do not summarise it, do not reorder it, and do not pick for them.

Wait for their answer, then re-run the same call with the chosen `idea_id` added:

```
-d '{"name":"<name>","agent":"claude-code","idea_id":"<the id they picked>"}'
```

The desk validates that id against their team memberships, so a typo is rejected
rather than handing them another team's database. The answer is stored — they are
asked once, not every session.

If they captain an idea they did **not** pick, the prompt already told them that
team cannot set itself up. Remind them once to tell an organizer, then move on.

### `"status": "waiting_for_captain"` — a teammate has to go first

Their team's credentials do not exist yet, and only the captain can create them.
Show the `message` field, which names the captain and the idea. **Do not retry in a
loop and do not try to work around it** — a second attempt would create a second
Supabase project for the same team, which is exactly what this prevents.

Tell them plainly what to do: ask the person named to run `/insurwreck:start`, then
run `/insurwreck:start` again themselves and they will get the same setup. If the
captain is unavailable, an organizer can provision the team for them. Then stop —
do not continue to Step 4b or later steps, because there is nothing yet to connect.

`captain_started: true` means the captain began and it did not finish — a laptop
sleeping or Claude Code closing mid-run does this. The `message` already says the
right thing, which is that the captain must run `/insurwreck:start` **again** rather
than for the first time. Do not paraphrase it into "they haven't started yet": the
captain has no reason to think anything is outstanding, and that wording sends both
of them looking for the wrong problem.

Store it (only on `"status": "ok"`):

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
