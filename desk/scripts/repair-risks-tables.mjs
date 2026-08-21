// Re-provision every team whose own Supabase project is missing its risks table.
//
//   # one secret, list supplied:
//   DESK_SESSION_TOKEN=... node desk/scripts/repair-risks-tables.mjs --emails a@x,b@y
//
//   # or let it find the list itself, which costs a second secret:
//   DESK_SESSION_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node desk/scripts/repair-risks-tables.mjs
//
//   ADMIN_KEY works in place of DESK_SESSION_TOKEN. Add --dry-run to print the
//   targets and call nothing, --concurrency N (1-6) to change the pace.
//
// Organizer-run, so 33 teams do not each have to be walked through
// /insurwreck:status by hand. It calls the same /api/provision endpoint an
// organizer would, once per affected team, using that team's captain as the
// subject - the endpoint is idempotent and additive, so a team that turns out to
// be fine costs one wasted call and changes nothing.
//
// WHY THIS EXISTS
//
// mintSupabase used to fire the risks DDL the moment the project's API keys
// appeared, but a new Supabase project exposes keys before Postgres accepts
// queries - so the create raced the database starting up and lost for 33 of 47
// teams. The retry that fixes it going forward does nothing for projects already
// provisioned: only another provision call re-attempts the DDL.
//
// It repairs the FLAG as well as the table, which hand-written SQL against each
// project would not: leaving risks_table_ready false means iw-status keeps
// reporting it pending forever and every later provision re-attempts it.

const DESK = (process.env.DESK_BASE_URL || "https://insurwreck-desk.preview.plumhq.com").replace(/\/+$/, "");
// The desk read is OPTIONAL. Its only job is working out WHO to re-provision,
// and that list can just as easily be handed in with --emails - which means an
// organizer holding nothing but a session token can run this. Requiring the
// service_role key to discover a list somebody already has is a needless second
// secret in play during an event.
const EMAILS = (() => {
  const i = process.argv.indexOf("--emails");
  if (i < 0) return null;
  return String(process.argv[i + 1] || "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
})();
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!EMAILS && (!SB_URL || !SB_KEY)) {
  console.error("ERROR: pass --emails a@plumhq.com,b@plumhq.com");
  console.error("       or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so it can find them itself.");
  process.exit(1);
}
// Either auth path /api/provision accepts. ADMIN_KEY is often the harder one to
// obtain in practice: Vercel marks it Sensitive, which means write-only - not even
// the dashboard shows it back - so if nobody kept a copy it has to be rotated.
// An organizer session token needs no rotation: verify at the desk as any
// ORGANIZER_EMAILS address and use the token that returns.
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const SESSION_TOKEN = process.env.DESK_SESSION_TOKEN || "";
if (!ADMIN_KEY && !SESSION_TOKEN) {
  console.error("ERROR: set ADMIN_KEY or DESK_SESSION_TOKEN (an organizer session token).");
  process.exit(1);
}
const authHeaders = ADMIN_KEY
  ? { "x-admin-key": ADMIN_KEY }
  : { authorization: `Bearer ${SESSION_TOKEN}` };

const DRY_RUN = process.argv.includes("--dry-run");
const CONCURRENCY = (() => {
  const i = process.argv.indexOf("--concurrency");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 3;
  // A provision can sit for ~75s polling for keys plus ~40s retrying the DDL, so
  // this is deliberately low: hammering 33 at once buys nothing and risks
  // tripping rate limits on the Supabase Management API mid-event.
  return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 3;
})();

function must(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`ERROR: ${name} is not set.`);
    process.exit(1);
  }
  return v;
}

async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// ------------------------------------------------------------------ find ----

let targets = [];

if (EMAILS) {
  targets = EMAILS.map((email) => ({ email, title: email }));
  console.log(`emails supplied : ${targets.length}`);
} else {
  const creds = await sb(
    "credentials?service=eq.supabase&revoked_at=is.null&idea_id=not.is.null" +
      "&select=idea_id,participant_email,payload"
  );
  const teams = await sb("idea_teams?role=eq.owner&select=idea_id,member_email,idea_title");
  const captain = new Map(teams.map((t) => [t.idea_id, t]));

  // A claim placeholder is not a provisioned project; skip those rather than
  // counting them as broken.
  const broken = creds.filter(
    (c) => !c.payload?.claiming && c.payload?.risks_table_ready !== true
  );

  console.log(`idea-keyed supabase credentials : ${creds.length}`);
  console.log(`missing the risks table         : ${broken.length}`);

  const orphans = [];
  for (const c of broken) {
    const cap = captain.get(c.idea_id);
    // No owner row means nothing to provision as. Reported rather than skipped
    // quietly - an idea with no captain is its own problem.
    if (!cap) {
      orphans.push(c.idea_id);
      continue;
    }
    targets.push({ idea_id: c.idea_id, email: cap.member_email, title: cap.idea_title });
  }
  if (orphans.length) {
    console.warn(`WARN: ${orphans.length} affected idea(s) have no owner row: ${orphans.join(", ")}`);
  }
}

if (targets.length === 0) {
  console.log("\nNothing to repair.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`\n--dry-run: would re-provision ${targets.length} team(s):`);
  for (const t of targets) console.log(`  ${t.title}  (as ${t.email})`);
  process.exit(0);
}

// --------------------------------------------------------------- repair ----

console.log(`\nRe-provisioning ${targets.length} team(s), ${CONCURRENCY} at a time.`);
console.log("Each can take a couple of minutes - the provision polls for keys and retries the DDL.\n");

const results = [];
let cursor = 0;

async function worker() {
  while (cursor < targets.length) {
    const t = targets[cursor++];
    const started = Date.now();
    try {
      const res = await fetch(`${DESK}/api/provision`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ email: t.email }),
        // Generous: the endpoint itself is allowed 300s by vercel.json.
        signal: AbortSignal.timeout(300000),
      });
      const body = await res.json().catch(() => ({}));
      const secs = Math.round((Date.now() - started) / 1000);
      if (!res.ok) {
        results.push({ ...t, ok: false, detail: `HTTP ${res.status} ${JSON.stringify(body).slice(0, 120)}` });
        console.log(`  ✗ ${t.title} — HTTP ${res.status} (${secs}s)`);
        continue;
      }
      const sbSvc = body?.services?.supabase || {};
      const fixed = sbSvc.risks_table_ready === true;
      results.push({ ...t, ok: fixed, detail: fixed ? "risks table ready" : `still pending: ${JSON.stringify(sbSvc.pending_parts || [])}` });
      console.log(`  ${fixed ? "✓" : "·"} ${t.title} — ${fixed ? "fixed" : "still pending"} (${secs}s)`);
    } catch (error) {
      results.push({ ...t, ok: false, detail: String(error.message).slice(0, 120) });
      console.log(`  ✗ ${t.title} — ${String(error.message).slice(0, 80)}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

// ---------------------------------------------------------------- report ----

const fixed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log(`\nfixed  : ${fixed.length}`);
console.log(`failed : ${failed.length}`);
for (const f of failed) console.log(`  ${f.title} (${f.email}) — ${f.detail}`);

if (failed.length) {
  console.log("\nRe-running is safe and picks up only what is still broken.");
}
