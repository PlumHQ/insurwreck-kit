import { sb, sha256 } from "./_lib.js";

// Read-only Plum data for participants, as an MCP server backed by Metabase.
//
// The boundary is the TOOL SURFACE, not Metabase. stats2 runs the Enterprise
// binary with no licence, so sandboxing, column masking and Blocked are all
// unavailable, and Metabase doesn't parse SQL — so anything that can run
// arbitrary SQL against database 2 can read all 850 tables. This server
// therefore never exposes arbitrary SQL. It can only execute saved questions
// whose IDs an organizer put on the allowlist, and the check is integer
// membership in a fixed set, not a filter over attacker-controlled text.
//
// Defence in depth, and its measured limit. METABASE_API_KEY is a key bound to
// the `insurwreck` group, which has no "create-queries" permission. Verified on
// the live instance: that key gets 403 from /api/dataset, so it cannot run a
// query of its own - only saved cards.
//
// What it does NOT buy us: Metabase permissions are a union, and every API key's
// backing user is automatically a member of "All Users". All Users holds read or
// write on 22 collections, so the key can also read and run cards there despite
// the insurwreck group being set to `none` on all of them. Collection scoping is
// therefore NOT a containment boundary here - only the allowlist below is, which
// is why participants never receive this key and every path checks the id.

const PROTOCOL_VERSION = "2025-06-18";
const ROW_CAP = 500;

const MB = () => (process.env.METABASE_URL || "https://stats2.plumhq.com").replace(/\/+$/, "");
const deskBase = () =>
  (process.env.DESK_BASE_URL || "https://insurwreck-desk.preview.plumhq.com").replace(/\/+$/, "");
const MB_KEY = () => process.env.METABASE_API_KEY || "";

// The allowlist. Nothing outside it is reachable, ever.
//
// Read from the database rather than an env var so organizers can publish a new
// slice mid-event without a redeploy. MCP_CARD_IDS still works as a seed and as
// a fallback if the table hasn't been created yet.
const envAllowlist = () =>
  String(process.env.MCP_CARD_IDS || "")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter(Number.isInteger);

async function allowlist() {
  const ids = new Set(envAllowlist());
  try {
    const rows = await sb("data_slices?select=card_id&enabled=is.true");
    for (const row of rows) {
      const id = parseInt(row.card_id, 10);
      if (Number.isInteger(id)) ids.add(id);
    }
  } catch (error) {
    // Table missing or unreachable: fall back to the env seed rather than
    // cutting everyone off mid-build.
    console.error("data_slices unavailable, using env allowlist:", error.message);
  }
  return ids;
}

// ------------------------------------------------------------------ auth ---

async function participantFor(req) {
  const auth = req.headers.authorization || "";
  const header = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = header || String(req.headers["x-api-key"] || "").trim();
  if (!token) return null;
  const rows = await sb(
    `credentials?service=eq.anthropic&revoked_at=is.null` +
      `&payload->>token_hash=eq.${sha256(token)}` +
      `&select=participant_email,payload&limit=1`
  );
  if (!rows.length) return null;
  return { email: rows[0].participant_email, full: Boolean(rows[0].payload?.full_data_access) };
}

// The escape hatch, off unless an organizer turns it on for one person.
//
// It exists because a published slice cannot anticipate every question, and an
// idea dying at 2pm for want of a join is worse than the risk of a wider read.
// But be clear about what it costs: this runs arbitrary SELECT against all 850
// tables, so the allowlist - the only real boundary - is gone for that person.
// It needs its own Metabase key with native-query rights, because the ordinary
// hackathon key is deliberately 403'd from /api/dataset.
const FULL_KEY = () => process.env.METABASE_FULL_KEY || "";

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|set|reset|listen|notify|begin|commit)\b/i;

function guardSelect(sql) {
  const q = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!q) throw new Error("empty query");
  if (!/^(select|with)\b/i.test(q)) throw new Error("only SELECT or WITH is allowed");
  if (q.includes(";")) throw new Error("one statement at a time - remove the semicolon");
  if (FORBIDDEN.test(q)) throw new Error("this connection is read-only");
  return q;
}

// -------------------------------------------------------------- metabase ---

async function mb(path, { method = "GET", body } = {}) {
  const res = await fetch(`${MB()}/api/${path}`, {
    method,
    headers: { "x-api-key": MB_KEY(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`metabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Reject anything not on the allowlist before a request is even shaped.
function requireAllowed(id, allowed) {
  const cardId = parseInt(id, 10);
  if (!Number.isInteger(cardId) || !allowed.has(cardId)) {
    throw new Error(
      `Dataset ${id} isn't available to you. Call list_datasets to see what is.`
    );
  }
  return cardId;
}

const summarize = (card) => ({
  id: card.id,
  name: card.name,
  description: card.description || null,
  columns: (card.result_metadata || []).map((c) => ({
    name: c.name,
    type: String(c.base_type || "").replace(/^type\//, ""),
  })),
  parameters: (card.parameters || []).map((p) => ({
    name: p.slug,
    type: p.type,
    required: Boolean(p.required),
  })),
});

// Metabase wants each parameter bound to its template tag. Build that from the
// card definition so participants pass plain {name: value} pairs.
function bindParameters(card, supplied) {
  const tags = card?.dataset_query?.native?.["template-tags"] || {};
  const byName = new Map(Object.values(tags).map((t) => [t.name, t]));
  return Object.entries(supplied || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => {
      const tag = byName.get(name);
      if (!tag) throw new Error(`Unknown parameter "${name}" for this dataset.`);
      return {
        type: tag.type === "date" ? "date/single" : "category",
        value: String(value),
        target: ["variable", ["template-tag", name]],
      };
    });
}

function toRows(result) {
  if (result?.status === "failed") {
    // Never surface Metabase's raw SQL error - it can echo the query text.
    throw new Error("That query failed to run. Try different parameters.");
  }
  const cols = (result?.data?.cols || []).map((c) => c.display_name || c.name);
  const rows = (result?.data?.rows || []).slice(0, ROW_CAP);
  return { cols, rows, truncated: (result?.data?.rows || []).length > ROW_CAP };
}

// ----------------------------------------------------------------- tools ---

const TOOLS = [
  {
    name: "list_datasets",
    description:
      "List the Plum data slices you can query, with their columns and any filters they accept. Start here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "describe_dataset",
    description:
      "Show one dataset's columns, the filters it accepts, and three sample rows, so you know what you're working with.",
    inputSchema: {
      type: "object",
      properties: { dataset_id: { type: "integer", description: "id from list_datasets" } },
      required: ["dataset_id"],
      additionalProperties: false,
    },
  },
  {
    name: "run_dataset",
    description:
      "Run a dataset and get its rows back. Pass filters as a plain object, e.g. {\"org\": \"ACME\"}. " +
      `Returns at most ${ROW_CAP} rows - aggregate or filter rather than pulling everything.`,
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "integer", description: "id from list_datasets" },
        filters: {
          type: "object",
          description: "Filter name to value, using names from describe_dataset",
          additionalProperties: { type: ["string", "number", "boolean"] },
        },
      },
      required: ["dataset_id"],
      additionalProperties: false,
    },
  },
  {
    name: "export_dataset",
    description:
      "Get a dataset as a downloadable file for the participant's app to load, rather than into this conversation. " +
      "Returns up to 2000 rows - Metabase's ceiling, which we cannot raise. Use it for seeding their Supabase. " +
      "If a slice is bigger than 2000 rows, an aggregated or tighter-filtered slice is the answer, not this tool.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "integer", description: "id from list_datasets" },
        format: { type: "string", enum: ["csv", "json"], description: "defaults to csv" },
      },
      required: ["dataset_id"],
      additionalProperties: false,
    },
  },
];

const FULL_TOOL = {
  name: "query_warehouse",
  description:
    "Run a read-only SQL SELECT directly against the Plum warehouse. You have this because an organizer " +
    "granted you wider access than the published slices. Prefer list_datasets first - the slices are faster, " +
    "already de-identified, and won't surprise you. Table and column names are camelCase and must be " +
    "double-quoted: SELECT c.\"claimedAmount\" FROM \"Claim\" c. Always bound the query with a WHERE clause; " +
    "several tables run to tens of millions of rows. This is real member data - aggregate it, don't screenshot it.",
  inputSchema: {
    type: "object",
    properties: { sql: { type: "string", description: "A single SELECT statement, no trailing semicolon" } },
    required: ["sql"],
    additionalProperties: false,
  },
};

async function callTool(name, args, participant) {
  const email = participant.email;
  if (!MB_KEY()) {
    return "The data connection isn't switched on yet. Tell an organizer that METABASE_API_KEY is unset on the desk.";
  }
  if (name === "query_warehouse") {
    if (!participant.full) throw new Error("You don't have direct warehouse access. Use list_datasets.");
    if (!FULL_KEY()) return "Direct access isn't configured. Tell an organizer that METABASE_FULL_KEY is unset.";
    const sql = guardSelect(args?.sql);
    console.warn(`FULL WAREHOUSE QUERY by ${email}: ${sql.slice(0, 400)}`);
    const res = await fetch(`${MB()}/api/dataset`, {
      method: "POST",
      headers: { "x-api-key": FULL_KEY(), "Content-Type": "application/json" },
      body: JSON.stringify({ type: "native", database: 2, native: { query: sql } }),
    });
    if (!res.ok) throw new Error(`warehouse refused the query (${res.status})`);
    const { cols, rows, truncated } = toRows(await res.json());
    return JSON.stringify({ columns: cols, row_count: rows.length, truncated, rows }, null, 2);
  }

  const allowed = await allowlist();
  if (!allowed.size) {
    return "No data slices have been published yet. Tell an organizer that MCP_CARD_IDS is empty.";
  }

  switch (name) {
    case "list_datasets": {
      const cards = await Promise.all(
        [...allowed].map((id) => mb(`card/${id}`).catch(() => null))
      );
      const live = cards.filter(Boolean).map(summarize);
      if (!live.length) return "No datasets are reachable right now. Tell an organizer.";
      return JSON.stringify(live, null, 2);
    }

    case "describe_dataset": {
      const id = requireAllowed(args?.dataset_id, allowed);
      const card = await mb(`card/${id}`);
      const result = await mb(`card/${id}/query`, { method: "POST", body: { parameters: [] } })
        .catch(() => null);
      const sample = result ? toRows(result) : { cols: [], rows: [] };
      return JSON.stringify(
        { ...summarize(card), sample_rows: sample.rows.slice(0, 3), sample_columns: sample.cols },
        null,
        2
      );
    }

    case "run_dataset": {
      const id = requireAllowed(args?.dataset_id, allowed);
      const card = await mb(`card/${id}`);
      const parameters = bindParameters(card, args?.filters);
      console.log(`mcp run card=${id} by ${email} params=${parameters.length}`);
      const result = await mb(`card/${id}/query`, { method: "POST", body: { parameters } });
      const { cols, rows, truncated } = toRows(result);
      return JSON.stringify(
        { dataset: card.name, columns: cols, row_count: rows.length, truncated, rows },
        null,
        2
      );
    }

    case "export_dataset": {
      const id = requireAllowed(args?.dataset_id, allowed);
      const format = args?.format === "json" ? "json" : "csv";
      const card = await mb(`card/${id}`);
      const url = `${deskBase()}/api/data/${id}.${format}`;
      return [
        `Download "${card.name}" from:`,
        `  ${url}`,
        "",
        "Use the participant's own token, then load the file into their Supabase:",
        "",
        `  curl -H "Authorization: Bearer $INSURWRECK_TOKEN" ${url} -o data.${format}`,
        "",
        "Capped at 2000 rows by Metabase. The response carries x-insurwreck-row-count,",
        "and x-insurwreck-truncated when it hit the cap - check it, and if the real",
        "answer needs more than 2000 rows, ask an organizer for an aggregated slice",
        "instead of paging. Don't read the file into context: write code that loads it",
        "into their database and query it there.",
      ].join("\n");
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --------------------------------------------------------------- handler ---

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Unauthenticated health probe. It reports whether the desk can actually
    // reach Metabase, because "no datasets are reachable" from inside a tool
    // call is indistinguishable from a bad key, a blocked egress or an empty
    // allowlist - and that ambiguity costs time on the day.
    let upstream = "unknown";
    try {
      const r = await fetch(`${MB()}/api/card/${[...(await allowlist())][0] ?? 0}`, {
        headers: { "x-api-key": MB_KEY() },
        signal: AbortSignal.timeout(8000),
      });
      upstream = r.ok ? "ok" : `http_${r.status}`;
    } catch (e) {
      upstream = `unreachable: ${String(e.message).slice(0, 60)}`;
    }
    return res.status(200).json({
      ok: true,
      server: "insurwreck-data",
      protocol: PROTOCOL_VERSION,
      metabase: upstream,
      metabase_key_set: Boolean(MB_KEY()),
      slices: (await allowlist().catch(() => new Set())).size,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let participant;
  try {
    participant = await participantFor(req);
  } catch (error) {
    return res.status(500).json(rpcError(null, -32603, String(error.message || error)));
  }
  if (!participant) return res.status(401).json(rpcError(null, -32001, "Invalid or missing token."));

  const message = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  const { id = null, method, params } = message || {};

  if (method && method.startsWith("notifications/")) return res.status(202).end();

  try {
    switch (method) {
      case "initialize":
        return res.status(200).json(
          rpcOk(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "insurwreck-data", version: "1.0.0" },
            instructions:
              "Read-only Plum data slices for the hackathon. Call list_datasets first. " +
              "This is confidential company data: don't screenshot it into Slack or put it on a slide.",
          })
        );

      case "tools/list": {
        const tools = participant.full ? [...TOOLS, FULL_TOOL] : TOOLS;
        return res.status(200).json(rpcOk(id, { tools }));
      }

      case "tools/call": {
        const text = await callTool(params?.name, params?.arguments || {}, participant);
        return res.status(200).json(rpcOk(id, { content: [{ type: "text", text }] }));
      }

      case "ping":
        return res.status(200).json(rpcOk(id, {}));

      default:
        return res.status(200).json(rpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    if (method === "tools/call") {
      return res.status(200).json(
        rpcOk(id, { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true })
      );
    }
    return res.status(200).json(rpcError(id, -32603, String(error.message || error)));
  }
}
