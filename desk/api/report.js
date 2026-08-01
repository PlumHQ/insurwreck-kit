import { sb, sbAll, organizerFor } from "./_lib.js";

// The event report: what got built, what it cost, what is still standing.
//
// This is the one page that carries every participant's address and personal
// model spend in a single view, so it is organizer-only and the data never
// ships in static HTML. /report is a shell; the numbers arrive here, behind
// organizerFor, exactly the way the ops console gets its roster.
//
// Everything is computed live. A report generated once and pasted into a file
// is wrong the moment someone redeploys, and this one is meant to survive the
// thirty-day teardown as the record of what happened.

// Organizer dry-runs and end-to-end test accounts sit in the same tables as
// real participants and would otherwise inflate every count. Overridable so a
// future event does not have to edit code to fix its own roster.
const EXCLUDED = new Set(
  String(
    process.env.REPORT_EXCLUDE_EMAILS ||
      "harish.n@plumhq.com,harish.n+test@plumhq.com,harish.n+iw-final@plumhq.com," +
        "harish.n+hack-e2e@plumhq.com,sarora.mx@gmail.com"
  )
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
);

// Must match provision.js. Counting fewer than the desk provisions reports a
// participant as fully set up while they are missing a service.
const SERVICES = [
  "vercel",
  "supabase",
  "anthropic",
  "resend",
  "agentmail",
  "n8n",
  "google_auth",
  "kula",
  "zendesk",
];

async function vercel(path, token) {
  const r = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`vercel ${r.status}`);
  return r.json();
}

// Two participants renamed their Vercel project mid-build, so anything that
// joins on project *name* silently loses them. Join on project id, which the
// credential payload recorded at mint time and which cannot drift.
async function vercelActivity(credentials) {
  const token = process.env.VERCEL_USER_TOKEN;
  const teamId = credentials.find((c) => c.service === "vercel")?.payload?.team_id;
  if (!token || !teamId) return { projectsById: new Map(), deploysByName: new Map(), reachable: false };

  const { projects } = await vercel(`/v9/projects?teamId=${teamId}&limit=100`, token);
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const deploysByName = new Map();
  let until = "";
  // Cap the walk: a runaway pagination loop here would hang the report rather
  // than return a slightly short deployment count.
  for (let page = 0; page < 20; page += 1) {
    const d = await vercel(
      `/v6/deployments?teamId=${teamId}&limit=100${until ? `&until=${until}` : ""}`,
      token
    );
    const batch = d.deployments || [];
    for (const dep of batch) {
      if (!deploysByName.has(dep.name)) deploysByName.set(dep.name, []);
      deploysByName.get(dep.name).push(dep);
    }
    until = d.pagination?.next;
    if (!until || !batch.length) break;
  }
  return { projectsById, deploysByName, reachable: true };
}

// The shortest alias is the clean production hostname; the longer ones carry
// the deployment hash or the author's name and are not what you would share.
function productionUrl(project, deploys) {
  const target = project?.targets?.production;
  const aliases = target?.alias || [];
  if (aliases.length) return `https://${[...aliases].sort((a, b) => a.length - b.length)[0]}`;
  if (target?.url) return `https://${target.url}`;
  const ready = deploys.filter((d) => d.state === "READY").sort((a, b) => b.created - a.created);
  return ready.length ? `https://${ready[0].url}` : null;
}

export default async function handler(req, res) {
  const who = await organizerFor(req).catch(() => null);
  if (!who) return res.status(401).json({ error: "organizer access required" });
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const [participants, credentials, usage] = await Promise.all([
      sbAll("participants?select=email,name,idea_brief,verified_at,provisioned_at,created_at&order=created_at.asc"),
      sbAll("credentials?select=participant_email,service,payload&revoked_at=is.null&order=created_at.asc"),
      // Paged: PostgREST caps a plain select at 1000 rows, which silently
      // truncated spend to a fifth of the real figure once already.
      sbAll("llm_usage?select=participant_email,model,input_tokens,output_tokens,cost_usd,created_at&order=id"),
    ]);

    const credsFor = new Map();
    for (const c of credentials) {
      if (!credsFor.has(c.participant_email)) credsFor.set(c.participant_email, {});
      credsFor.get(c.participant_email)[c.service] = c.payload || {};
    }

    const spendFor = new Map();
    for (const u of usage) {
      const acc = spendFor.get(u.participant_email) || { cost: 0, calls: 0, tin: 0, tout: 0 };
      acc.cost += Number(u.cost_usd || 0);
      acc.calls += 1;
      acc.tin += u.input_tokens || 0;
      acc.tout += u.output_tokens || 0;
      spendFor.set(u.participant_email, acc);
    }

    let activity = { projectsById: new Map(), deploysByName: new Map(), reachable: false };
    try {
      activity = await vercelActivity(credentials);
    } catch {
      // Vercel unreachable is not fatal: the desk half of the report still
      // tells you who registered, who was provisioned and what was spent.
    }

    const rows = [];
    for (const p of participants) {
      const email = String(p.email || "").toLowerCase();
      const c = credsFor.get(p.email) || {};
      const project = activity.projectsById.get(c.vercel?.project_id);
      const deploys = project ? activity.deploysByName.get(project.name) || [] : [];
      const spend = spendFor.get(p.email) || { cost: 0, calls: 0, tin: 0, tout: 0 };
      const idea = String(p.idea_brief || "").trim();

      rows.push({
        name: p.name || "",
        email: p.email,
        test: EXCLUDED.has(email),
        idea,
        exploring: !idea || /explor/i.test(idea),
        project: project?.name || c.vercel?.project_name || null,
        renamed: Boolean(project && c.vercel?.project_name && project.name !== c.vercel.project_name),
        // Minted, then deleted. Their deployments went with it, so an empty
        // deploy count here means "no longer knowable", not "never built".
        project_gone: Boolean(activity.reachable && c.vercel?.project_id && !project),
        dash: project ? `https://vercel.com/${c.vercel?.team_slug || "insurwreck"}/${project.name}` : null,
        url: productionUrl(project, deploys),
        deploys: deploys.length,
        sb: c.supabase?.project_ref || null,
        calls: spend.calls,
        cost: Number(spend.cost.toFixed(2)),
        tin: spend.tin,
        tout: spend.tout,
        missing: SERVICES.filter((s) => !c[s]),
        status: deploys.length ? "shipped" : spend.calls ? "started" : "idle",
      });
    }
    rows.sort((a, b) => b.deploys - a.deploys || b.cost - a.cost || a.name.localeCompare(b.name));

    const real = rows.filter((r) => !r.test);
    const allDeploys = [...activity.deploysByName.values()].flat();
    const budget = Number(process.env.LLM_BUDGET_USD || 20);

    // Hour buckets in IST, which is the only clock anyone at the event was on.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const hours = {};
    const byDay = {};
    for (const d of allDeploys) {
      const ist = new Date(d.created + IST_OFFSET_MS);
      const day = ist.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
      if (day === (process.env.REPORT_EVENT_DAY || "2026-07-31")) {
        const h = ist.getUTCHours();
        hours[h] = (hours[h] || 0) + 1;
      }
    }

    const models = {};
    for (const u of usage) models[u.model] = (models[u.model] || 0) + 1;

    const sum = (k) => real.reduce((s, r) => s + r[k], 0);

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      generated_for: who,
      vercel_reachable: activity.reachable,
      participants: rows,
      timeline: Object.keys(hours)
        .map(Number)
        .sort((a, b) => a - b)
        .map((h) => ({ h, n: hours[h] })),
      byday: Object.entries(byDay)
        .sort()
        .map(([d, n]) => ({ d, n })),
      models: Object.entries(models)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => ({ m, n })),
      totals: {
        people: real.length,
        excluded: rows.length - real.length,
        shipped: real.filter((r) => r.status === "shipped").length,
        started: real.filter((r) => r.status === "started").length,
        idle: real.filter((r) => r.status === "idle").length,
        briefs: real.filter((r) => !r.exploring).length,
        deploys: allDeploys.length,
        ready: allDeploys.filter((d) => d.state === "READY").length,
        failed: allDeploys.filter((d) => d.state === "ERROR").length,
        eventday: Object.values(hours).reduce((s, n) => s + n, 0),
        peak: Math.max(0, ...Object.values(hours)),
        spend: Number(sum("cost").toFixed(2)),
        budget: budget * real.length,
        tin: sum("tin"),
        tout: sum("tout"),
        grants: SERVICES.length * rows.length,
        landed: credentials.length,
        sbprojects: rows.filter((r) => r.sb).length,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
