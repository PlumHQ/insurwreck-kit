---
name: demo-in-3-minutes
description: Use when the participant says it's time to present, asks how to demo, or wants help prepping their pitch. Confirms the live site actually loads, pins a known-good deployment they can fall back to, and drafts a 3-line pitch.
---

Three minutes to demo, and you get one shot. Do the boring safety checks first, then the pitch.

## Step 1 — Confirm the live URL actually works

Find the URL: check `services.vercel.note` in `~/.insurwreck/credentials.json` for the exact link, or fall back to whatever `iw-deploy` last printed. Use the production URL, not a preview link — previews can sit behind Vercel's login wall.

```
curl -s -o /dev/null -w "%{http_code}" "$URL"
```

- **200** — good, move on.
- **401 / 403, or a redirect to a vercel.com login page** — this is a stale auth wall, not a broken app. It usually means Vercel's Deployment Protection is still on, or they're demoing a preview URL instead of production. Fix: point them at the production URL from `iw-deploy` (no `--preview` flag), or tell them to turn off Deployment Protection for the production environment in their Vercel project settings.
- **Anything else (5xx, timeout, connection refused)** — this is `fix-my-deploy` territory. Say so and hand off to that skill rather than debugging it here.

## Step 2 — Pin a deployment that works

The real risk isn't the site being down, it's a last-minute edit breaking it ten
minutes before they present. Vercel keeps every deployment at its own permanent
URL, so the fix is to capture the one that currently works:

```bash
vercel ls --token "$(node -e 'console.log(require(require("os").homedir())+"/.insurwreck/credentials.json").services.vercel.token)')" 2>/dev/null | head -5
```

Simpler and more reliable: right after you confirm a 200 in Step 1, save that
exact URL somewhere they can find it. Write it into `DEMO.md` at the top of their
project along with the time you checked it. If the production URL breaks on
stage, they open that one instead.

Tell them plainly: **stop deploying once it works.** The most common way a demo
dies is a change pushed at the last minute with no time to check it.

Also have them take a screenshot by hand right now — Cmd+Shift+4 on macOS, drag
over the browser — and keep it open in a tab. Do not try to automate this: there
is no browser tool in their setup, and installing one costs a 150MB download they
don't have time for. Ten seconds by hand beats ten minutes of tooling.

## Step 3 — Draft the 3-line pitch

Pull their idea brief from credentials and whatever you know about what they actually built (README, the running app, what got seeded). Write exactly three lines, in their voice, not corporate:

```
Problem: <the recurring pain, one sentence, no jargon>
Built: <what the app actually does, concretely — not "a platform for X">
Wow: <the one moment that lands — a number, a before/after, something that surprises>
```

Keep each line short enough to say out loud in under 15 seconds. If the "wow" line is weak or generic, push back and ask them what actually surprised them while building it — that's usually the real wow moment, not the feature list.

Read it back to them once before they go up.
