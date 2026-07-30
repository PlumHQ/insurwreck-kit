# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) now, before making any change in this repo.** It is the single source of truth for how to work here, and it is short. This file exists only so the three rules that cause real damage are impossible to miss.

This repo is live infrastructure. The desk serves real hackathon participants, and several people and agents push to `main` every hour.

## The three that matter most

1. **Never run `vercel deploy`.** The project is git-connected (`PlumHQ/insurwreck-kit` → `main` → root `desk`); pushing to `main` is the deploy. A manual deploy ships your local tree over everyone else's work and silently deletes endpoints you don't have locally — this already caused an outage on 2026-07-30.

2. **`git pull --rebase` immediately before every push.** Others are pushing constantly. Never force-push `main`.

3. **No secrets in this repo — it goes public before the event.** Master keys live only in the Vercel environment; `desk/.env.example` documents them by name. Run `git diff --cached | grep -nE 'sbp_|vcp_|re_[A-Za-z0-9]|GOCSPX|eyJhbGciOi'` before committing and expect zero hits.

Everything else — idempotent minters, failing closed, verifying against real APIs, the two-file version bump, and the list of platform limits not worth re-litigating — is in [AGENTS.md](AGENTS.md). Read it.
