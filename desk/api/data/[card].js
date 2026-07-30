import { sb, sha256 } from "../_lib.js";

// Bulk export. The MCP `run_dataset` tool is capped at 500 rows because its
// results go into the model's context window - that's a token limit, not an
// access limit. This route is the other half: the FULL result set of the same
// allowlisted card, streamed as CSV or JSON, for the participant's app to load
// into their own Supabase and query without limits.
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

  // Metabase's export endpoints return the full result set, not the UI's
  // display limit - that's exactly what we want here.
  const upstream = await fetch(`${MB()}/api/card/${cardId}/query/${format}`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.METABASE_API_KEY || "",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "parameters=[]",
  });

  if (!upstream.ok) {
    return res.status(502).json({ error: `Metabase export failed (${upstream.status}).` });
  }

  console.log(`bulk export card=${cardId} format=${format} by ${email}`);

  res.status(200);
  res.setHeader(
    "content-type",
    format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8"
  );
  res.setHeader("content-disposition", `attachment; filename="dataset-${cardId}.${format}"`);

  // Stream it through rather than buffering - these can be large.
  if (upstream.body) {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    return res.end();
  }
  return res.send(await upstream.text());
}
