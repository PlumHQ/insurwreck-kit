---
description: Show your Insurwreck registration and credential status
---

Show the participant their current Insurwreck setup state.

1. Run `iw-status`. It reads `~/.insurwreck/credentials.json` and prints the table in a fixed format, so the layout is the same for everyone every time. It never prints a secret. Then **reproduce its output inside a fenced code block** — Claude Code folds long tool output behind a "+N lines" summary, so a table left as tool output arrives cut off. Copy it verbatim; do not re-format, re-order or re-align it. If it reports no setup found, tell them to run `/insurwreck:start` and stop. If `iw-status` is missing, fall back to reading the bundle yourself.
2. Add one short line of your own underneath — what stands out, not a re-listing of the table. If everything is ready, name a concrete next step from their idea brief. Do not repeat the table in prose.
3. If anything is pending, offer to re-fetch the bundle: ask for confirmation, then re-run onboarding Steps 3–4 from `/insurwreck:start` (a fresh OTP is required — the desk does not persist sessions on disk). If everything is ready, suggest the next build step based on their idea brief instead.

Never print API keys or tokens in full — show the service name and the last 4 characters at most.
