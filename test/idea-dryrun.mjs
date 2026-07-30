// Take one real registered idea end to end, the way a participant's agent would.
//
//   node test/idea-dryrun.mjs
//
// The idea is `slash.` (Santhosh V): 45 days before renewal an AM knows premium
// paid and claims paid, and so does the insurer, who loads the renewal price on
// past trend. But not every past claim repeats - a big claimant may have left
// the org. slash. finds the claims unlikely to recur and prices that argument.
//
// That needs two slices joined, real money arithmetic, the model to reason over
// the result, and somewhere to put it. If this passes, the kit works for an idea
// rather than merely responding to a health check.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the desk's own store),
//      plus whatever the desk needs. DESK defaults to a local shim.

import { mintAnthropic, mintSupabase, mintN8n, mintAgentmail } from "../desk/api/_minters.js";
import { sb } from "../desk/api/_lib.js";

const DESK = process.env.DESK_TEST_URL || "http://localhost:3999";
const EMAIL = "idea-dryrun@plumhq.com";

let pass = 0, fail = 0;
const ok = (m, extra = "") => { console.log(`  \x1b[32m✓\x1b[0m ${m}${extra ? `  \x1b[2m${extra}\x1b[0m` : ""}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const step = (n, m) => console.log(`\n\x1b[1m${n}. ${m}\x1b[0m`);

let TOKEN, supa;

const rpc = async (method, params) => {
  const r = await fetch(`${DESK}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json())?.result;
};
const tool = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return text; }
};

try {
  // ── 1. the participant arrives ────────────────────────────────────────────
  step(1, "Provision a participant");
  await sb("participants?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { email: EMAIL, name: "slash. dry run", idea_brief: "Which past claims won't recur, and what that's worth at renewal." },
  });
  for (const [svc, fn] of Object.entries({ anthropic: mintAnthropic, n8n: mintN8n, agentmail: mintAgentmail })) {
    const payload = await fn(EMAIL, {});
    await sb("credentials?on_conflict=participant_email,service", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { participant_email: EMAIL, service: svc, minted_live: true, payload },
    });
    if (svc === "anthropic") TOKEN = payload.api_key;
    ok(`${svc} minted`);
  }

  // ── 2. discover the data, without being told what exists ──────────────────
  step(2, "Discover the data the way an agent would");
  const datasets = await tool("list_datasets");
  if (!Array.isArray(datasets)) throw new Error(`list_datasets: ${String(datasets).slice(0, 160)}`);
  ok(`list_datasets`, `${datasets.length} slices offered`);

  const lives = datasets.find((d) => d.name === "lives_roster");
  const claims = datasets.find((d) => d.name === "claims_summary");
  lives && claims
    ? ok("found both slices this idea needs", `${lives.name} #${lives.id}, ${claims.name} #${claims.id}`)
    : no("the slices slash. needs are not published");

  const shape = await tool("describe_dataset", { dataset_id: lives.id });
  const cols = (shape.columns || []).map((c) => c.name);
  cols.includes("has_exited") && cols.includes("member_ref_hash")
    ? ok("lives_roster exposes exits, and only hashed member refs", `${cols.length} columns`)
    : no(`lives_roster shape unexpected: ${cols.join(", ")}`);

  // ── 3. the actual question ────────────────────────────────────────────────
  step(3, "Answer the question the idea exists to answer");
  const roster = await tool("run_dataset", { dataset_id: lives.id });
  if (!roster?.rows?.length) throw new Error("lives_roster returned nothing");
  const iEx = roster.columns.findIndex((c) => /exited/i.test(c));
  const exited = roster.rows.filter((r) => r[iEx] === true || r[iEx] === "true");
  ok("lives_roster queried", `${roster.row_count} lives, ${exited.length} already exited`);

  const claimRows = await tool("run_dataset", { dataset_id: claims.id });
  const cCols = claimRows.columns;
  const iPaid = cCols.findIndex((c) => /paid/i.test(c));
  const iOrg = cCols.findIndex((c) => /^org/i.test(c));
  const totalPaid = claimRows.rows.reduce((t, r) => t + (Number(r[iPaid]) || 0), 0);
  ok("claims_summary queried", `${claimRows.row_count} claims, ₹${Math.round(totalPaid).toLocaleString("en-IN")} paid`);

  // The real analytical shape: which orgs carry the most paid claims, so an AM
  // can go and check who of those has since left.
  const byOrg = new Map();
  for (const r of claimRows.rows) {
    const k = r[iOrg] || "unknown";
    byOrg.set(k, (byOrg.get(k) || 0) + (Number(r[iPaid]) || 0));
  }
  const top = [...byOrg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  top.length
    ? ok("aggregated to a renewal argument", `top org ₹${Math.round(top[0][1]).toLocaleString("en-IN")} across ${byOrg.size} orgs`)
    : no("could not aggregate");

  // ── 4. the model reasons over it, through the gateway ─────────────────────
  step(4, "Have the model reason over it, through the gateway");
  const prompt =
    `You are helping a Plum account manager prepare a renewal negotiation.\n` +
    `Top organisations by claims paid in the window:\n` +
    top.map(([o, v]) => `- ${o}: ${Math.round(v)}`).join("\n") +
    `\n\nOf ${roster.row_count} covered lives sampled, ${exited.length} have already exited.\n` +
    `In two sentences, state the argument the AM should make to the insurer.`;

  const llm = await fetch(`${DESK}/api/llm/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
  });
  const out = await llm.json();
  const answer = out?.content?.[0]?.text?.trim();
  if (!answer) throw new Error(`gateway: ${JSON.stringify(out).slice(0, 200)}`);
  ok("gateway answered", `${out.usage.input_tokens}in / ${out.usage.output_tokens}out`);
  console.log(`\n     \x1b[2m${answer.replace(/\n/g, "\n     ")}\x1b[0m\n`);

  const spend = (await sb(`llm_usage?participant_email=eq.${EMAIL}&select=cost_usd`))
    .reduce((t, r) => t + Number(r.cost_usd), 0);
  spend > 0 ? ok("that call was metered against their budget", `$${spend.toFixed(6)} of $15`) : no("nothing metered");

  // ── 5. bulk data for the app they deploy ──────────────────────────────────
  step(5, "Pull the bulk data their deployed app would read");
  const csvRes = await fetch(`${DESK}/api/data/${claims.id}.csv`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const csv = await csvRes.text();
  const lines = csv.trim().split("\n");
  csvRes.ok && lines.length > 100
    ? ok("bulk CSV retrieved", `${lines.length - 1} rows, ${(csv.length / 1024).toFixed(0)} KB, truncated=${csvRes.headers.get("x-insurwreck-truncated") || "false"}`)
    : no(`bulk export: ${csvRes.status} ${csv.slice(0, 120)}`);

  const header = lines[0].split(",");
  const leaky = header.filter((h) => /member_?name|patient|phone|dob|birth/i.test(h));
  leaky.length === 0
    ? ok("no direct identifiers in the export", header.slice(0, 4).join(", ") + " …")
    : no(`identifiers present: ${leaky.join(", ")}`);

  // ── 6. their own database ─────────────────────────────────────────────────
  step(6, "Land it in their own Supabase");
  supa = await mintSupabase(EMAIL, {});
  if (supa.incomplete) {
    ok("supabase project created, keys still settling", `pending: ${supa.pending_parts}`);
  } else {
    const probe = await fetch(`${supa.url}/rest/v1/`, {
      headers: { apikey: supa.service_role_key, Authorization: `Bearer ${supa.service_role_key}` },
    });
    probe.ok ? ok("their project answers with their own key", supa.project_ref)
             : no(`their project: HTTP ${probe.status}`);
  }

} catch (e) {
  no(`aborted: ${e.message}`);
} finally {
  // ── cleanup ────────────────────────────────────────────────────────────────
  try {
    const creds = await sb(`credentials?participant_email=eq.${EMAIL}&select=service,payload`);
    for (const c of creds) {
      if (c.service === "agentmail" && c.payload?.inbox_id) {
        await fetch(`https://api.agentmail.to/v0/inboxes/${c.payload.inbox_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}` } });
      }
    }
    await sb(`llm_usage?participant_email=eq.${EMAIL}`, { method: "DELETE" });
    await sb(`credentials?participant_email=eq.${EMAIL}`, { method: "DELETE" });
    await sb(`participants?email=eq.${EMAIL}`, { method: "DELETE" });
    console.log(`\n  \x1b[2mcleaned up${supa?.project_ref ? ` (supabase project ${supa.project_ref} left for manual removal)` : ""}\x1b[0m`);
  } catch { /* best effort */ }

  console.log(`\n\x1b[1m  ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
}
