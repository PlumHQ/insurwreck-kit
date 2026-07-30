# Your Insurwreck starter app

This is a working app with two demos already built in. Nothing here is fake UI —
both pages actually call Claude, and the email button actually sends mail. Your job
today is to point Claude Code at the parts you want to change and describe what
you want differently. You don't need to write any code yourself.

## The two demos

- **Claims Dashboard** (`/dashboard`) — a table of sample insurance claims with a
  button that asks Claude to flag each one Low/Medium/High risk. Good starting
  point if your idea is a dashboard, a classifier, or anything that scores/labels
  a list of things.
- **Document Generator** (`/generate`) — a form where you describe a letter or
  email, Claude drafts it, and you can download it as a file or send it for real
  with Resend. Good starting point if your idea is about writing or sending
  something.

Most ideas fit one of these two shapes. Pick the one closer to yours and ask
Claude to delete the other route — or keep both if your idea genuinely needs both.

## Getting it running

Ask Claude Code:

> "Run the setup script, then start the dev server."

That's `npm run setup` (pulls in your event credentials automatically — no keys
to copy by hand) followed by `npm run dev`. The app opens at `http://localhost:3000`.

## Which files to point Claude at

- `data/claims.seed.json` — the sample claims. Ask Claude to "replace this with
  data that matches my idea" and describe the columns you actually need.
- `app/dashboard/page.tsx` and `components/ClaimsDashboard.tsx` — the dashboard
  page and its table/filters.
- `app/api/dashboard/classify/route.ts` — what Claude is asked to do with each
  row. Ask Claude to "change the prompt so it scores/labels claims for X instead."
- `app/generate/page.tsx` and `components/GenerateForm.tsx` — the generator
  form's fields.
- `app/api/generate/route.ts` — what Claude is asked to draft. Ask Claude to
  "change this so it writes Y instead of a claims letter."
- `app/page.tsx` — the home page. Ask Claude to "rewrite the homepage copy for
  my idea."

You almost never need to touch anything under `lib/` or `app/api/generate/send` —
that's the Claude/Resend wiring, already working.

## Real data instead of the sample file

By default the dashboard reads `data/claims.seed.json`, so it renders instantly
with zero setup. If your idea needs a real database, ask Claude:

> "Set this dashboard up to read from Supabase instead of the seed file."

Claude will run `supabase/schema.sql` against your project and flip the switch
that's already commented into `lib/claims.ts`.

## Shipping it

Ask Claude Code:

> "Deploy this to Vercel."

That's `vercel deploy`. Your Vercel project and token are already set up from
your event credentials.

## If something breaks

Ask Claude: "why isn't this working?" and paste whatever error you're seeing. It
has full context on this codebase and can usually fix it in one pass. If it's
stuck on credentials specifically, ask it to run `/insurwreck:status`.
