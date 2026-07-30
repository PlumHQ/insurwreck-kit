#!/usr/bin/env node
// Refresh the materialised copy of every published slice.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... METABASE_API_KEY=... \
//     node desk/scripts/refresh-slices.mjs
//
// Run this from a machine whose IP the warehouse proxy allows. The desk itself
// cannot - Vercel's egress gets a plain nginx 403 from stats2 - which is the
// whole reason this exists. Safe to re-run; it upserts.

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MB = (process.env.METABASE_URL || "https://stats2.plumhq.com").replace(/\/+$/, "");
const MB_KEY = process.env.METABASE_API_KEY;

if (!SUPA || !KEY || !MB_KEY) {
  console.error("Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and METABASE_API_KEY.");
  process.exit(1);
}

const sb = async (path, init = {}) => {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const slices = await sb("data_slices?select=card_id,name&enabled=is.true");
if (!slices.length) {
  console.error("No published slices. Publish one from the organizer console first.");
  process.exit(1);
}

console.log(`Refreshing ${slices.length} slices from ${MB}\n`);

let ok = 0;
for (const { card_id, name } of slices) {
  const started = Date.now();
  try {
    const r = await fetch(`${MB}/api/card/${card_id}/query`, {
      method: "POST",
      headers: {
        "x-api-key": MB_KEY,
        "Content-Type": "application/json",
        ...(process.env.METABASE_GATE_SECRET
          ? { "X-Insurwreck-Gate": process.env.METABASE_GATE_SECRET }
          : {}),
      },
      body: JSON.stringify({ parameters: [] }),
    });
    if (!r.ok) {
      throw new Error(
        `metabase ${r.status}` +
          (r.status === 403 ? " - is this machine on the warehouse IP allowlist?" : "")
      );
    }
    const d = await r.json();
    if (d?.status === "failed") throw new Error("the card itself failed to run");

    const columns = (d.data?.cols || []).map((c) => c.display_name || c.name);
    const rows = d.data?.rows || [];

    await sb("slice_cache?on_conflict=card_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: {
        card_id,
        name,
        columns,
        rows,
        row_count: rows.length,
        refreshed_at: new Date().toISOString(),
      },
    });

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ok    ${String(card_id).padEnd(6)} ${name.padEnd(22)} ${String(rows.length).padStart(5)} rows  ${secs}s`);
    ok++;
  } catch (error) {
    console.log(`  FAIL  ${String(card_id).padEnd(6)} ${name.padEnd(22)} ${error.message}`);
  }
}

console.log(`\n${ok}/${slices.length} refreshed`);
process.exit(ok === slices.length ? 0 : 1);
