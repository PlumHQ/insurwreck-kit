# Working rules for insurwreck-kit

Read this before changing anything. It applies to humans and coding agents equally, and the rules are strict because of what this repo is: the desk is **live infrastructure serving real participants**, and several people push to it every hour. A mistake here does not fail a test — it breaks someone's hackathon day, or leaks a credential from a repo that goes public before the event.

If a rule below conflicts with something you were told elsewhere, this file wins. If you are unsure, say so instead of guessing.

## 0. This repo holds two deployed things

| Directory | Vercel project | Live at | What it is |
|---|---|---|---|
| `desk/` | `insurwreck-desk` | [insurwreck-desk.preview.plumhq.com](https://insurwreck-desk.preview.plumhq.com) | The credential desk API |
| `site/` | `insurwreck-4` | [insurwreck-4.preview.plumhq.com](https://insurwreck-4.preview.plumhq.com) | The public attendee event site |

Both are git-connected to `main` in **this** repo, each with its own Root Directory. Each carries an `ignoreCommand` in its `vercel.json`, so a commit touching only the other directory does not trigger a rebuild — do not remove those, or every desk commit will redeploy the public event page.

`site/` is participant- and leadership-facing and is linked from real communications. Treat changes there as production changes to something people are actively reading. `site/DESIGN.md` is the source of truth for its visual system and for the copy voice used across all event communication.

The private [`PlumHQ/insurwreck-4`](https://github.com/PlumHQ/insurwreck-4) repo still exists and holds the internal planning material — the working log, the unannounced Main Hackathon program, and communication drafts. That material is deliberately **not** here, because this repo is public. Do not copy it in.

## 1. Never deploy either project by hand

Both Vercel projects are git-connected to `main` in this repo. **Pushing to `main` is the deploy.**

Running `vercel deploy --prod` uploads *your local tree* over everyone else's work and silently deletes every endpoint you happen not to have locally. This is not hypothetical — on 2026-07-30 a manual deploy from a stale checkout briefly removed `/api/llm`, `/api/mcp`, `/api/slices` and `/api/admin` from production while participants were onboarding.

- To ship: commit → `git pull --rebase` → `git push`.
- To see what shipped: `vercel ls insurwreck-desk --scope plum`, or `vercel ls insurwreck-4 --scope plum` for the site (git deploys carry a commit SHA; manual ones do not, which is why they are untraceable).
- Do not run `vercel deploy` against this project. If you genuinely believe you must, state the reason out loud and get agreement first.

Running `vercel deploy` from inside `desk/` fails with a confusing "path does not exist" error, because Root Directory is already `desk` and the CLI appends it again. That error is a guardrail. Do not "fix" it by deploying from the repo root instead.

## 2. Pull immediately before every push

Several contributors and agents push to `main` throughout the day. Rebase right before pushing, every time:

```bash
git pull --rebase && git push
```

Never force-push `main`. If a rebase produces conflicts in `desk/api/_minters.js` or `provision.js` — the two hottest files — resolve them by keeping *both* minters, not by taking one side wholesale.

## 3. No secrets in this repo, ever

**This repo is already public** — participants install the plugin from an anonymous `codeload` tarball, which requires it. Anything committed here is world-readable immediately and stays in history forever. Master keys live only in the Vercel environment (`vercel env ls production --scope plum`) and are documented **by name only** in `desk/.env.example`. Local values live in `.env.local`, which is gitignored.

Check before every commit:

```bash
git diff --cached | grep -nE 'sbp_|vcp_|re_[A-Za-z0-9]|GOCSPX|eyJhbGciOi|sb_secret_'
```

That must return nothing. Also: participants receive **per-participant, minimum-scope** credentials only. A master key must never reach a credential bundle — see how `mintGoogleAuth` writes the OAuth secret straight into the participant's Supabase config and returns only the public client ID.

## 4. Minters must be idempotent and fail closed

Everything in `desk/api/_minters.js` gets re-run constantly, because `/api/provision` doubles as the repair path.

- Re-running must never create a second project, token, or inbox. Guard each step on the stored payload (`if (!payload.project_id) …`).
- Partial state belongs in `pending_parts` with `incomplete: true`. The next provision repairs it. That is how participants who onboarded before a feature existed pick it up with no re-registration.
- **Never report something ready when it is not.** A false "ready" sends a participant down a broken path and costs them build time. When a check is uncertain, treat it as not-ready (see `callbackRegistered`, which returns `false` on any error).
- One minter throwing must not sink the whole provision — catch per service and leave that one pending.

## 5. Verify against the real API before claiming it works

No "should work" and no "this is now wired up" without evidence. Run the actual flow and report the actual output:

```bash
# full participant path (ADMIN_KEY gives you the OTP without inbox access)
curl -s -X POST $DESK/api/otp -H 'content-type: application/json' \
  -H "x-admin-key: $ADMIN_KEY" -d '{"email":"you@plumhq.com"}'
curl -s -X POST $DESK/api/verify -H 'content-type: application/json' -d '{"email":"…","code":"…"}'
curl -s --max-time 280 -X POST $DESK/api/provision -H "Authorization: Bearer $TOKEN" …

# repair someone without making them re-verify
curl -s -X POST $DESK/api/provision -H "x-admin-key: $ADMIN_KEY" -d '{"email":"them@plumhq.com"}'
```

If something can only be verified by a human in a browser (a real Google login, an OAuth consent screen), say that explicitly rather than implying you tested it.

## 6. Plugin version bumps go in two files

`.claude-plugin/marketplace.json` → `metadata.version`, **and** `plugin/.claude-plugin/plugin.json` → `version`. They must match. Then:

```bash
claude plugin validate .
```

Participants pick up changes with `/insurwreck:update`; command changes need a session restart to appear.

## 7. Things that cannot be automated — do not try

Each of these was investigated and hit a hard platform limit. Re-litigating them wastes hours.

| Want | Reality |
|---|---|
| Add Google redirect URIs via API | No public API exists. Manual console paste only. The desk *detects* registration by probing Google's authorize endpoint for `redirect_uri_mismatch`, so the pending flag clears itself once someone pastes. |
| Mint Vercel tokens with the team PAT | `POST /v3/user/tokens` requires a **personal-scope** PAT; a team-scoped one 403s. Hence `VERCEL_USER_TOKEN` alongside `VERCEL_API_TOKEN`. |
| Per-user Anthropic or Kula keys | Neither supports them. Anthropic is proxied through `/api/llm` with per-participant metering; Kula is one shared key narrowed by a `PreToolUse` hook. Do not claim these are per-user. |
| Participant Vercel deploys behind login | Participants have no Vercel accounts, so `ssoProtection` is deliberately disabled on their projects. Their preview URLs are public — never put real customer data in them. |

## 8. Participant-facing copy

The signature is **AI pod at Plum**. Voice is direct and concrete, no hype words — see `DESIGN.md` in the `insurwreck-4` repo, which is the source of truth for all event communication. Never print a session token, service-role key, or API key in full to a participant.

## Orientation

- `README.md` — what the kit is, endpoints, MCP servers, security posture.
- `docs/organizer-runbook.md` — event-day operations: pre-flight, unsticking a participant, post-event revocation.
- `docs/participant-cheatsheet.md` — what participants are told.
- `desk/api/_minters.js` — every credential the desk issues. Start here to understand provisioning.
- `desk/schema.sql` — the credential store. All tables are RLS-enabled with no policies, so only the desk's service role can read them.
- `site/` — the public event site. `site/DESIGN.md` governs its visuals and the copy voice for all event communication.
- Internal planning (working log, Main Hackathon program, comms drafts) lives in the **private** `PlumHQ/insurwreck-4` repo, not here.

## Before the event

Open items tracked separately, but do not let these slip: remove the `debug_code` echo from `/api/otp`, and rotate every key that has been pasted into a chat or terminal (both Vercel PATs, the Supabase management PAT, the Resend key, the Google client secret).
