---
name: idea-to-template
description: Use when the participant says they don't know what to build, asks for help getting started, says they're still exploring, or only has a vague idea. Maps their idea brief to a starter shape, scaffolds it from the plugin template, and gets a dev server running.
---

Get them from "I have a vague idea" to "a server is running on my laptop" — but through a short product conversation, not around it. The project's `CLAUDE.md` is the contract here, and a `require-brief.sh` hook blocks application code until `BRIEF.md` exists, so scaffolding first will simply be denied.

## Step 1 — Read their idea brief, then talk

```
node -e 'console.log(require(require("os").homedir()+"/.insurwreck/credentials.json").participant.idea_brief || "")'
```

Whatever it says — even if it reads like a complete spec — ask **3 to 5 questions in one message** about the problem and the people, never the implementation. Who has this problem and what do they do today, what decision should this make easier, what would they look at first thing in the morning, what does success look like in one sentence, what is the smallest version that would still be useful.

Do not ask which framework, database or library. Those are your call and the stack is already provisioned.

At most **one** follow-up round, and only to settle something that changes what you build first. Then write `BRIEF.md` in the project folder — problem, who it is for, what the first slice does, what is out of scope today — and move. If they say "just build it" or "you decide", write `BRIEF.md` from your best reading, state the assumption in one line, and go. The brainstorm must never become the reason nothing shipped.

## Step 2 — Map the brief to a shape

The starter template (`${CLAUDE_PLUGIN_ROOT}/templates/starter`) is one Next.js app with **both** shapes already built as working routes — nothing to pick apart at copy time, both actually call Claude already:

- **`/dashboard`** — a table of sample claims with a button that asks Claude to flag each row Low/Medium/High risk. Fits: viewing data, spotting patterns, sorting/tagging, routing or triaging, a queue, anything you'd otherwise build in a spreadsheet.
- **`/generate`** — a form where you describe a letter/email, Claude drafts it, and it can be downloaded or sent for real via Resend. Fits: drafting emails, generating a document, summarizing into a brief, follow-ups, replies.

Map their brief to whichever route is the closer starting point. If genuinely ambiguous, default to `/dashboard` — broader, and easier to bend toward a generator later than the reverse.

If the brief ends with the member seeing something **in the Plum app**, that last mile is a mock inside their own app — there is no write path into Plum and there will not be one. Same for WhatsApp: a chat UI they own, not the real thing. Settle that in Step 1, so the build is shaped around it instead of hitting it on Friday.

## Step 3 — Copy the starter

```bash
SRC="${CLAUDE_PLUGIN_ROOT}/templates/starter"
DEST="./$(basename "$PWD")-app"   # or scaffold in place if already in an empty project dir — use judgment
mkdir -p "$DEST"
cp -r "$SRC"/. "$DEST"/
cd "$DEST"
```

Then immediately commit it to the shape you picked in Step 2:

```bash
node scripts/pick.mjs dashboard    # or: generate
```

**Do this every time, before anything else.** It removes the other route, its API handlers and its component, points the home page at what is left, and trims the nav. Skip it and the two-card chooser we wrote for ourselves ships to their live URL - which is exactly what happened to the first people who deployed.

Idempotent and reversible: the full template is still at `${CLAUDE_PLUGIN_ROOT}/templates/starter` if they later want the other half.

Copying the provided starter is not what the brief gate is guarding against, so this works before `BRIEF.md` exists; writing bespoke application code does not.

## Step 4 — Wire it up and run setup

```
npm run setup
```

This is `node scripts/setup.mjs` — it pulls in their event credentials from `~/.insurwreck/credentials.json` automatically, no keys typed by hand. If it fails, fall back to `npm install` and tell them plainly what setup step is missing — don't paper over a broken template silently.

## Step 4b — Make it look like Plum

Invoke the `plum-design` skill before you write any UI. Plum's tokens, type and
rules are there, with a drop-in stylesheet. Every app deployed today carries
Plum's name; none of them should open in default slate-and-indigo.

## Step 5 — Get a dev server running

```
npm run dev
```

Confirm it's actually serving (check the printed local URL at `http://localhost:3000`, or curl it) before telling them it's ready. Then tell them, in one or two sentences, what they're looking at and the one thing to try first — e.g. "open localhost:3000/dashboard, hit the risk-flag button, that's Claude scoring the sample claims already."

Build the smallest useful slice on top of the template, show it, and ask what is wrong with it rather than whether to keep going. Update `BRIEF.md` whenever they change direction — it is the shared record of what this is and what you both agreed to leave out.

Point them to the route-specific files next if they want to customize (`data/claims.seed.json` and `app/api/dashboard/classify/route.ts` for the dashboard shape; `app/generate/page.tsx` and `app/api/generate/route.ts` for the generator shape — the template's own `README.md` has the full file map). Hand off to `load-your-data` when they mention their own spreadsheet or real data, and `demo-in-3-minutes` when they're ready to present.
