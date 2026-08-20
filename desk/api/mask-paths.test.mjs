// Proves every path that returns warehouse rows masks before it returns them.
// Stubs Supabase and Metabase; nothing leaves the machine.
process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
process.env.METABASE_URL = "https://stub.metabase";
process.env.METABASE_API_KEY = "stub-mb-key";
process.env.METABASE_FULL_KEY = "stub-full-key";
process.env.MCP_CARD_IDS = "19638";
process.env.CLAIMS_MASK_SALT = "test-salt-not-a-real-one";

const PII = ["Rajesh Kumar", "rajesh@example.com", "9876543210"];
const COLS = ["member_id", "member_name", "member_email", "member_phone", "org_name", "comment_body"];
const ROW  = ["7000111222", "Rajesh Kumar", "rajesh@example.com", "9876543210", "Acme Technologies",
              "Called Rajesh Kumar on 9876543210"];
const CARD = { id: 19638, name: "iw_claims_base", description: "Claim spine", result_metadata: [], parameters: [] };
const QRES = { data: { cols: COLS.map((c) => ({ name: c, display_name: c })), rows: [ROW, ROW] } };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
  if (u.includes("stub.supabase.co")) {
    if (u.includes("credentials?")) return json([{ participant_email: "a@plumhq.com", payload: { full_data_access: true } }]);
    if (u.includes("data_slices")) return json([{ card_id: 19638, enabled: true }]);
    if (u.includes("slice_cache")) return json([{ card_id: 19638, name: "iw_claims_base", columns: COLS, rows: [ROW], row_count: 1, refreshed_at: new Date(0).toISOString() }]);
    return json([]);
  }
  if (u.includes("/api/card/19638/query") || u.includes("/api/dataset")) return json(QRES);
  if (u.includes("/api/card/19638")) return json(CARD);
  return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
};

const mcp = (await import("./mcp.js")).default;
async function rpc(method, params) {
  let out;
  const req = { method: "POST", headers: { authorization: "Bearer tok" }, body: { jsonrpc: "2.0", id: 1, method, params } };
  const res = { status: () => res, json: (b) => { out = b; return res; }, setHeader: () => res, send: () => res, end: () => res, write: () => res };
  await mcp(req, res);
  return out;
}
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args }))?.result?.content?.[0]?.text ?? "";

let pass = 0, fail = 0;
const ok = (l, c) => { c ? pass++ : (fail++, console.log(`FAIL ${l}`)); };
function clean(label, text) {
  for (const p of PII) ok(`${label}: no "${p}"`, !text.includes(p));
  ok(`${label}: org name survives`, text.includes("Acme Technologies"));
  ok(`${label}: pseudonym present`, /Member [0-9a-f]{8}/.test(text));
  ok(`${label}: member_id survives`, text.includes("7000111222"));
}

clean("run_dataset",      await call("run_dataset", { dataset_id: 19638 }));
clean("describe_dataset", await call("describe_dataset", { dataset_id: 19638 }));
clean("query_warehouse",  await call("query_warehouse", { sql: "SELECT 1" }));

// snapshot fallback: make the live query fail so cached() takes over
const live = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/api/card/19638/query")) throw new Error("stats2 down");
  return live(url, init);
};
clean("run_dataset snapshot", await call("run_dataset", { dataset_id: 19638 }));
globalThis.fetch = live;

// the bulk export, both formats
const exp = (await import("./data/[card].js")).default;
async function download(fmt) {
  let body = "", headers = {};
  const res = {
    status: () => res, setHeader: (k, v) => { headers[k] = v; return res; },
    json: (b) => { body = JSON.stringify(b); return res; },
    send: (b) => { body += b; return res; }, write: (b) => { body += b; return res; },
    end: () => res,
  };
  await exp({ method: "GET", headers: { authorization: "Bearer tok" }, query: { card: `19638.${fmt}` } }, res);
  return { body, headers };
}
for (const fmt of ["csv", "json"]) {
  const { body, headers } = await download(fmt);
  clean(`export .${fmt}`, body);
  ok(`export .${fmt}: declares masking in headers`, /names/.test(headers["x-insurwreck-masked"] || ""));
  ok(`export .${fmt}: member_id survives`, body.includes("7000111222"));
}

// the join key must be intact in every one of them
const r = await call("run_dataset", { dataset_id: 19638 });
const parsed = JSON.parse(r);
ok("member_id column still listed", parsed.columns.includes("member_id"));
ok("join_keys advertised to the agent", (parsed.join_keys || []).includes("member_id"));
ok("member_id value preserved", parsed.rows[0][0] === "7000111222");
ok("member_phone masked though same shape as member_id", /^phone_[0-9a-f]{8}$/.test(parsed.rows[0][3]));

console.log(`\nmask paths: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
