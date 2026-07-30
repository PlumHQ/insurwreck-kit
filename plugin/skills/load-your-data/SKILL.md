---
name: load-your-data
description: Use when the participant asks how to get their data in, connect a spreadsheet, mentions a CSV or Excel file, wants to use real data, or asks about pulling from the Plum warehouse. Branches by data source and seeds their own Supabase project.
---

Figure out which of three shapes this is, then act. Don't ask more than you need to.

## Branch 1 — They have a CSV / Excel file

1. Ask for the file path (or confirm the one they just dropped into the project).
2. Read a sample of it (first ~20 rows) to infer columns and types — don't assume, look.
3. Create a table in their own Supabase project that matches, and seed it:
   - Get connection details from `~/.insurwreck/credentials.json` → `services.supabase` (`url`, `service_role_key`).
   - Write a small one-off script (Node, using `@supabase/supabase-js` or plain `fetch` to PostgREST) that creates the table if missing and inserts the parsed rows in batches. Keep it disposable — this is a hackathon seed script, not production migration tooling.
   - Run it, then confirm row count matches the source file.
4. Tell them the table name and that it's now queryable from their app.

## Branch 2 — They want to paste data in (no file)

1. Ask them to paste a few rows (or the shape of what they have in mind) directly in chat.
2. Infer the schema from what they pasted.
3. Scaffold a seed file in their project (e.g. `seed/data.json` or `supabase/seed.sql`, matching whatever the starter template already uses) with that data hardcoded.
4. Wire it to run via `npm run setup` or a one-off `node seed/run.js` — check what the template expects rather than inventing a new convention.

## Branch 3 — They want real Plum data (the warehouse)

There's no spreadsheet to hand out — it's a read-only slice of Plum's data exposed as an MCP data source (`insurwreck-data`, already registered in the plugin's `.mcp.json`). No DB password, no Metabase login: their existing token is the auth.

1. Check the MCP tools are reachable — call `list_datasets`. If it fails with an auth error, the participant's environment is likely missing `INSURWRECK_TOKEN`; set it from their own bundle and retry:
   ```
   export INSURWRECK_TOKEN=$(node -e 'console.log(require(require("os").homedir()+"/.insurwreck/credentials.json").services.anthropic.api_key)')
   ```
2. Run `list_datasets` and show them what's available. Each entry has an `id`, a name, a description, its columns, and the filters it accepts. Don't guess at names — read them from the response, because organizers can publish new slices during the event.
3. Run `describe_dataset` with that slice's `dataset_id` to see real columns, types and three sample rows before doing anything else.
4. Run it with `run_dataset`, passing filters as a plain object keyed by the filter names `describe_dataset` reported:
   ```
   run_dataset(dataset_id: 1234, filters: { org: "ACME", from: "2026-04-01" })
   ```
   You do not write SQL here. Each slice is a fixed, pre-approved query; filters are the only thing that varies, and at most 500 rows come back. Do the aggregation yourself over those rows.
5. If the slice they need doesn't exist, don't try to work around it — tell them to ask an organizer to publish one. It takes a couple of minutes and no deploy.

## The warning (say this plainly, every time real data is in play)

This is confidential Plum data, even in its de-identified form. **Never screenshot it into Slack, and never put a raw row on a slide.** Aggregate numbers and charts in the final demo are fine — raw records are not. If they're loading their own CSV of real member or customer data (not the warehouse slice), the same rule applies: it stays in their own Supabase project, never pasted into chat, Slack, or a deck.
