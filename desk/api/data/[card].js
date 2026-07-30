import { sb, sha256 } from "../_lib.js";

// Bulk export, for loading a slice into the participant's own Supabase rather
// than into the model's context. `run_dataset` caps at 500 rows because tool
// results consume context; this route returns everything Metabase will give us.
//
// That ceiling is 2000 rows, and it is not ours to raise. Metabase's own
// download endpoints (/query/csv, /query/json, /query/xlsx) are blocked at the
// reverse proxy in front of stats2 - a deliberate control against bulk
// warehouse export - so we go through /api/card/:id/query, which returns at most
// 2000 bare rows, and format the result here. A participant needing more should
// ask an organizer to publish an aggregated or tighter-filtered slice.
//
//   curl -H "Authorization: Bearer $INSURWRECK_TOKEN" \
//     https://<desk>/api/data/1234.csv -o data.csv
//
// Same token, same allowlist, same service account. Only the destination
// differs: a file they own instead of the model's context.

const MB = () => (process.env.METABASE_URL || "https://stats2.plumhq.com").replace(/\/+$/, "");

async function participantFor(req) {
  const auth = req.headers.authorization || "";
  const header = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = header || String(req.headers["x-api-key"] || "").trim();
  if (!token) return null;
  const rows = await sb(
    `credentials?service=eq.anthropic&revoked_at=is.null` +
      `&payload->>token_hash=eq.${sha256(token)}` +
      `&select=participant_email&limit=1`
  );
  return rows.length ? rows[0].participant_email : null;
}

async function allowed(cardId) {
  const env = String(process.env.MCP_CARD_IDS || "")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter(Number.isInteger);
  if (env.includes(cardId)) return true;
  try {
    const rows = await sb(`data_slices?select=card_id&enabled=is.true&card_id=eq.${cardId}`);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const email = await participantFor(req).catch(() => null);
  if (!email) return res.status(401).json({ error: "Invalid or missing token." });

  // /api/data/1234.csv -> card 1234, format csv
  const raw = String(req.query?.card || "");
  const match = raw.match(/^(\d+)(?:\.(csv|json))?$/);
  if (!match) return res.status(400).json({ error: "Use /api/data/<id>.csv or .json" });

  const cardId = parseInt(match[1], 10);
  const format = match[2] || "csv";

  if (!(await allowed(cardId))) {
    return res.status(403).json({ error: `Dataset ${cardId} isn't published to you.` });
  }

  const upstream = await fetch(`${MB()}/api/card/${cardId}/query`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.METABASE_API_KEY || "",
      "Content-Type": "application/json",
      ...(process.env.METABASE_GATE_SECRET
        ? { "X-Insurwreck-Gate": process.env.METABASE_GATE_SECRET }
        : {}),
    },
    body: JSON.stringify({ parameters: [] }),
  });

  if (!upstream.ok) {
    return res.status(502).json({ error: `Metabase query failed (${upstream.status}).` });
  }

  const result = await upstream.json();
  if (result?.status === "failed") {
    return res.status(502).json({ error: "That dataset failed to run." });
  }
  const cols = (result?.data?.cols || []).map((c) => c.display_name || c.name);
  const rows = result?.data?.rows || [];

  console.log(`bulk export card=${cardId} format=${format} rows=${rows.length} by ${email}`);

  res.status(200);
  res.setHeader("content-disposition", `attachment; filename="dataset-${cardId}.${format}"`);
  res.setHeader("x-insurwreck-row-count", String(rows.length));
  if (rows.length >= 2000) res.setHeader("x-insurwreck-truncated", "true");

  if (format === "json") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.send(JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])))));
  }

  res.setHeader("content-type", "text/csv; charset=utf-8");
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.write(cols.map(cell).join(",") + "\n");
  for (const row of rows) res.write(row.map(cell).join(",") + "\n");
  return res.end();
}
