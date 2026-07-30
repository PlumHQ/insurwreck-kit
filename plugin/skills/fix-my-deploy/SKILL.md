---
name: fix-my-deploy
description: Use when the participant says their site is broken, down, showing a blank page, throwing an error, or a "vercel deploy" / "npm run build" command failed. Runs iw-doctor, reads the output, and explains the fix in plain English — no jargon.
---

Someone's build or deploy just broke. Be calm and concrete: run the check, read what it says, fix the actual thing.

## Step 1 — Run the doctor

```
iw-doctor
```

It's already on PATH. Read its full output before saying anything to the participant — don't guess from the trigger phrase alone.

## Step 2 — The #1 real cause: secrets that never left their laptop

This is the failure that hits almost everyone, so check for it first even if the doctor didn't flag it explicitly.

**What's happening:** their app works on `localhost` because a file called `.env` (or `.env.local`) sits on their computer with the settings the app needs — a database URL, an API key, whatever. That file never gets uploaded to Vercel. Vercel builds and runs the site somewhere else entirely, without that file, so the live site is missing the same settings and breaks — even though "it works on my machine."

**How to tell:** `iw-doctor` prints `you have a local .env — those values do NOT reach Vercel automatically` when both `.env`/`.env.local` and `.vercel/project.json` exist. Also check yourself: `ls .env .env.local 2>/dev/null` and `ls .vercel/project.json 2>/dev/null` — if both exist, this is almost certainly it.

**Explain it like this to the participant:** "Your site works on your laptop because of a settings file that only lives on your laptop. Vercel never saw it, so the live version is missing those settings. I'm going to copy them over now."

**Fix it — push each variable to Vercel, then redeploy:**

```bash
CREDS="$HOME/.insurwreck/credentials.json"
TOKEN=$(node -e 'console.log(require(process.argv[1]).services.vercel.token)' "$CREDS")
SCOPE=$(node -e 'console.log(require(process.argv[1]).services.vercel.team_slug || "insurwreck")' "$CREDS")

[ -f .vercel/project.json ] || vercel link --yes --token "$TOKEN" --scope "$SCOPE"

for envfile in .env .env.local; do
  [ -f "$envfile" ] || continue
  while IFS='=' read -r key value; do
    case "$key" in ''|'#'*) continue ;; esac
    value="${value%\"}"; value="${value#\"}"
    printf '%s' "$value" | vercel env add "$key" production --token "$TOKEN" --yes >/dev/null 2>&1
    printf '%s' "$value" | vercel env add "$key" preview --token "$TOKEN" --yes >/dev/null 2>&1
  done < "$envfile"
done
```

Then redeploy: `iw-deploy`. Tell them what you just did in one sentence — don't dump the raw output. Never print the actual variable values in chat; the loop above pipes them straight to Vercel without echoing.

## Step 3 — Other common breakages

Only go here if Step 2 doesn't apply or doesn't fix it.

- **Missing tools/credentials** (`iw-doctor` shows `✗ node`, `✗ credentials found`, etc.): follow its own `note` line — it already tells them exactly what to run.
- **`npm install` never ran**: doctor shows `dependencies not installed` → run `npm install`, then retry the build.
- **Build fails locally too** (`npm run build` errors before Vercel is even involved): the error is a real code problem, not a deploy problem. Read the actual error text and fix that — don't blame Vercel for a bug that's in the code.
- **Blank page but build succeeded**: usually a JavaScript error in the browser, not a deploy problem. Ask them to open the browser console (or check `vercel logs` / `vercel inspect --token <token>` from Step 2's TOKEN) and read the real error before guessing.
- **Secrets committed into source instead of `.env`**: if you spot a real key hardcoded in a tracked file, that's a different problem — point them at fixing the leak (rotate the key, move it to `.env`), don't just silence the symptom.

## Ground rule

Plain English only. Say "your settings file didn't reach the server" — never "the environment variable injection failed at build time." They're leadership at a hackathon, not engineers.
