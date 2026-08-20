# Insurwreck 4.0 — one-page cheatsheet

You don't need to know git, slash commands, or env vars. Just talk to Claude Code. Here's what happens when you say things.

| Say this (or anything like it) | What happens |
|---|---|
| "My site is down" / "it broke" / "blank page" / a failed deploy or build | Claude runs a health check, reads the result, and explains the fix in plain English. The #1 cause: your local settings file (`.env`) never reached Vercel — Claude copies it over and redeploys. |
| "I don't know what to build" / "help me start" / "I'm still exploring" | Claude asks you one question, picks a starting shape (data dashboard vs. document/email generator), scaffolds it, and gets a dev server running on your laptop. |
| "How do I get my data in" / "connect my spreadsheet" / mentions a CSV | Claude parses your file (or a pasted sample) and seeds it into your own database. If you want real Plum data instead, it queries a read-only, de-identified slice for you — no spreadsheet needed. |
| "How do I use real Plum data" | Claude lists what's available, shows you the columns, and runs a sample query. It reads live, de-identified slices — safe to explore, not safe to publish (see below). |
| "Get ready to present" / "how do I demo" / "prep my pitch" | Claude checks your live URL actually loads, saves a screenshot as a backup in case the site dies mid-pitch, and drafts a 3-line pitch: problem → what you built → the wow moment. |

## The one step people miss

When setup finishes it tells you to **quit Claude Code and start it again**. Do
it. Until you do, anything touching Plum data fails in a way that looks like the
data server is broken. If you are unsure whether it worked, ask for something
real — "show me claims by status" — and run `iw-doctor` if it doesn't.

## Your address

Setup asks for a short name for your site, and that becomes the web address you
demo on: `<your-name>.insurwreck.com`. Deploy to it any time with `iw-deploy`.
It is in your bundle as `services.vercel.app_url` if you forget.

Didn't pick a name? You still get a working address, just an uglier one. Ask an
organizer if you want it changed.

## Things happening quietly in the background

- **Auto-save.** Every time Claude writes or edits a file, it quietly checkpoints your work as a commit. You get an undo you never had to ask for — if something breaks, just tell Claude "go back to before that change."
- **Secret protection.** If a real API key or token gets pasted straight into your code instead of your settings file, Claude will stop and explain why, instead of letting it get committed.
- **Guardrails on destructive commands.** Claude won't run commands that wipe your whole home folder, your whole disk, or throw away uncommitted work with no way back. It'll ask what you actually meant instead.

None of this blocks you — it's there so a wrong keystroke doesn't end your hackathon.

## Confidentiality — read this once

Some of what you can pull in (the Plum data slice, and anything from your own org's real records) is confidential company data, even de-identified. **Never screenshot it into Slack, and never put a raw row on a slide.** Aggregate numbers and charts in your final demo are fine. Raw records are not.

## After setup, in order

1. **Restart Claude Code.** See above. This is the step people miss.
2. **Talk about the problem first.** Claude asks a few questions about who has
   the problem and what would make their morning easier, then writes `BRIEF.md`.
   Application code is deliberately blocked until that exists — the day is worth
   more if the thing you build is shaped by you rather than guessed at.
3. **It scaffolds and starts a dev server** on your laptop, as either a data
   dashboard or a document/email generator, whichever fits your brief.
4. **Build by saying what you want.** "Get my spreadsheet in", "connect Zendesk",
   "make it look like Plum", "it broke."
5. **`iw-deploy`** puts it on your address.
6. **"Get ready to present"** checks the URL loads, saves a screenshot as a
   backup, and drafts a three-line pitch.

## If you get stuck

Just say what's wrong — "it broke," "I don't know what to do," "how do I demo this." Claude figures out which of the above applies. If nothing helps, flag an organizer.
