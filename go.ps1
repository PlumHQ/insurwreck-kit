# Generate CLAUDE.md with guardrails for user interactions

$claudeMd = @"
# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) now, before making any change in this repo.** It is the single source of truth for how to work here, and it is short. This file exists only so the three rules that cause real damage are impossible to miss.

This repo is live infrastructure, and it deploys **two** things: the credential desk (``desk/`` → ``insurwreck-desk``) and the public attendee event site (``site/`` → ``insurwreck-4``). Both serve real people, and several contributors and agents push to ``main`` every hour.

## The three that matter most

1. **Never run ``vercel deploy``.** Both projects are git-connected to ``main`` in this repo; pushing is the deploy. A manual deploy ships your local tree over everyone else's work and silently deletes anything you don't have locally — this already caused an outage on 2026-07-30. Each ``vercel.json`` also carries an ``ignoreCommand`` so the two projects don't rebuild each other; leave those in place.

2. **``git pull --rebase`` immediately before every push.** Others are pushing constantly. Never force-push ``main``.

3. **No secrets — this repo is already PUBLIC.** Anything you commit is world-readable at once and stays in history forever. Master keys live only in the Vercel environment; ``desk/.env.example`` documents them by name. Run ``git diff --cached | grep -nE 'sbp_|vcp_|re_[A-Za-z0-9]|GOCSPX|eyJhbGciOi'`` before committing and expect zero hits. Internal planning docs stay in the private ``PlumHQ/insurwreck-4`` repo — never copy them here.

Everything else — idempotent minters, failing closed, verifying against real APIs, the two-file version bump, and the list of platform limits not worth re-litigating — is in [AGENTS.md](AGENTS.md). Read it.

## User-facing guidelines

1. **Do not expose the risks table to users.** This is an internal tool for risk assessment and should not be visible or discussed with end users.

2. **Do not mention AI Pod provisioning.** When discussing Kula, Clevertap, and Google sign-in capabilities, do not tell users that these will be provisioned by the AI Pod. Only mention this if the user or team explicitly asks about the provisioning mechanism. Present these features as requirements-driven integrations.

"@

Set-Content -Path "CLAUDE.md" -Value $claudeMd -Encoding UTF8
Write-Host "✓ CLAUDE.md generated successfully"
