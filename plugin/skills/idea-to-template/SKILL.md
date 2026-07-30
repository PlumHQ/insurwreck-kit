---
name: idea-to-template
description: Use when the participant says they don't know what to build, asks for help getting started, says they're still exploring, or only has a vague idea. Maps their idea brief to a starter shape, scaffolds it from the plugin template, and gets a dev server running.
---

Get them from "I have a vague idea" to "a server is running on my laptop" in one shot. Don't overthink the mapping — pick a shape and move.

## Step 1 — Read their idea brief

```
node -e 'console.log(require(require("os").homedir()+"/.insurwreck/credentials.json").participant.idea_brief || "")'
```

If it's empty or says "still exploring," ask **one** clarifying question — something like "give me one sentence: are you trying to look at data and make a call, or turn something into a written document/email?" — then proceed. Don't ask more than one question before acting.

## Step 2 — Map the brief to a shape

The starter template (`${CLAUDE_PLUGIN_ROOT}/templates/starter`) is one Next.js app with **both** shapes already built as working routes — nothing to pick apart at copy time, both actually call Claude already:

- **`/dashboard`** — a table of sample claims with a button that asks Claude to flag each row Low/Medium/High risk. Fits: viewing data, spotting patterns, sorting/tagging, routing or triaging, a queue, anything you'd otherwise build in a spreadsheet.
- **`/generate`** — a form where you describe a letter/email, Claude drafts it, and it can be downloaded or sent for real via Resend. Fits: drafting emails, generating a document, summarizing into a brief, follow-ups, replies.

Map their brief to whichever route is the closer starting point. If genuinely ambiguous, default to `/dashboard` — broader, and easier to bend toward a generator later than the reverse.

## Step 3 — Copy the starter

```bash
SRC="${CLAUDE_PLUGIN_ROOT}/templates/starter"
DEST="./$(basename "$PWD")-app"   # or scaffold in place if already in an empty project dir — use judgment
mkdir -p "$DEST"
cp -r "$SRC"/. "$DEST"/
cd "$DEST"
```

Copy the whole template — both routes come along regardless of shape; don't try to split it. Once it's running (Step 5), offer to delete the route they don't need (`app/dashboard` or `app/generate` plus its `app/api/...` counterpart) — only if they want a cleaner starting point, not by default.

## Step 4 — Wire it up and run setup

```
npm run setup
```

This is `node scripts/setup.mjs` — it pulls in their event credentials from `~/.insurwreck/credentials.json` automatically, no keys typed by hand. If it fails, fall back to `npm install` and tell them plainly what setup step is missing — don't paper over a broken template silently.

## Step 5 — Get a dev server running

```
npm run dev
```

Confirm it's actually serving (check the printed local URL at `http://localhost:3000`, or curl it) before telling them it's ready. Then tell them, in one or two sentences, what they're looking at and the one thing to try first — e.g. "open localhost:3000/dashboard, hit the risk-flag button, that's Claude scoring the sample claims already."

Point them to the route-specific files next if they want to customize (`data/claims.seed.json` and `app/api/dashboard/classify/route.ts` for the dashboard shape; `app/generate/page.tsx` and `app/api/generate/route.ts` for the generator shape — the template's own `README.md` has the full file map). Hand off to `load-your-data` when they mention their own spreadsheet or real data, and `demo-in-3-minutes` when they're ready to present.
