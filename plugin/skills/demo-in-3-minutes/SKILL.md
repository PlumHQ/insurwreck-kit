---
name: demo-in-3-minutes
description: Use when the participant says it's time to present, asks how to demo, or wants help prepping their pitch. Confirms the live site actually loads, grabs a fallback screenshot in case it dies on stage, and drafts a 3-line pitch.
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

## Step 2 — Fallback screenshot, in case it dies mid-pitch

Take a screenshot of the live URL now, while it works, using whichever browser tool is available (Playwright or Chrome MCP). Save it into the project as something obvious like `demo-fallback.png`. Tell the participant it exists and where — if the site falls over on stage, they open the image instead of refreshing and panicking.

## Step 3 — Draft the 3-line pitch

Pull their idea brief from credentials and whatever you know about what they actually built (README, the running app, what got seeded). Write exactly three lines, in their voice, not corporate:

```
Problem: <the recurring pain, one sentence, no jargon>
Built: <what the app actually does, concretely — not "a platform for X">
Wow: <the one moment that lands — a number, a before/after, something that surprises>
```

Keep each line short enough to say out loud in under 15 seconds. If the "wow" line is weak or generic, push back and ask them what actually surprised them while building it — that's usually the real wow moment, not the feature list.

Read it back to them once before they go up.
