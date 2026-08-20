import { sb, sbAll, nowIso, readBody, normalizeEmail, organizerFor } from "./_lib.js";

// Organizer actions, one endpoint, dispatched on `action`. Everything here is
// something an organizer needs to do in under a minute while 25 people are
// building - so it lives behind a page, not a slash command.
//
// Auth is the shared ADMIN_KEY, or a session belonging to an address listed in
// ORGANIZER_EMAILS. The second is there so organizers can log in with the same
// OTP flow participants use, instead of pasting a secret into a browser.

const MB = () => (process.env.METABASE_URL || "https://stats2.plumhq.com").replace(/\/+$/, "");

// Is each moving part actually configured and reachable? This is the question
// organizers ask at 8am, and guessing at it from env vars alone is how you find
// out at 9 that something never worked.
async function health() {
  const env = (k) => Boolean(process.env[k]);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  try {
    await sb("participants?select=email&limit=1");
    add("desk -> supabase", true, "reachable");
  } catch (e) {
    add("desk -> supabase", false, e.message.slice(0, 90));
  }

  // A present env var proves nothing. "agentmail key set" read green for three
  // hours while every inbox create returned 403 limit_exceeded, and a
  // participant found it before this panel did. Anything we can cheaply call,
  // we call; anything we cannot, we label honestly as configured rather than
  // working.
  for (const [name, key] of [
    ["anthropic key configured", "ANTHROPIC_API_KEY"],
    ["metabase key configured", "METABASE_API_KEY"],
    ["claims api configured", "PLUM_API_TOKEN"],
    ["kula key configured", "KULA_API_KEY"],
    ["zendesk creds configured", "ZENDESK_TOKEN"],
    ["clevertap creds configured", "CLEVERTAP_PASSCODE"],
    ["clevertap email allowlist set", "CLEVERTAP_EMAILS"],
    ["kula email allowlist set", "KULA_EMAILS"],
    ["supabase mgmt token configured", "SUPABASE_MGMT_TOKEN"],
  ]) {
    add(name, env(key), env(key) ? "" : "missing - that service will stay pending");
  }

  const probe = async (name, run, note) => {
    try {
      const { ok, detail } = await run();
      add(name, ok, detail || note || "");
    } catch (e) {
      add(name, false, String(e.message).slice(0, 70));
    }
  };

  await probe("agentmail can create inboxes", async () => {
    if (!env("AGENTMAIL_API_KEY")) return { ok: false, detail: "no key" };
    const r = await fetch("https://api.agentmail.to/v0/inboxes?limit=100", {
      headers: { Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    const d = await r.json();
    const used = Number(d.count ?? (d.inboxes || []).length);
    // Shared-inbox mode needs one seat, not one per person, so a full account
    // is only fatal when we are still minting per participant.
    const sharedMode = env("AGENTMAIL_SHARED_INBOX");
    return {
      ok: sharedMode || used < 10,
      detail: `${used} inboxes used` + (sharedMode ? ", shared mode" : " of a 10 cap"),
    };
  });

  await probe("clevertap creds work", async () => {
    if (!env("CLEVERTAP_ACCOUNT_ID") || !env("CLEVERTAP_PASSCODE")) {
      return { ok: false, detail: "no creds" };
    }
    // Say plainly how many people the gate lets through. "Configured" told an
    // organizer nothing about whether the allowlist was empty, which is the
    // state where CleverTap looks broken to every participant by design.
    const allowed = (process.env.CLEVERTAP_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean).length;
    // A read the account always answers: an unknown identity is a clean 400/200,
    // while bad creds are a 401. Deliberately a GET - this panel must never be
    // the thing that writes to a live engagement account.
    const region = process.env.CLEVERTAP_REGION || "in1";
    const r = await fetch(
      `https://${region}.api.clevertap.com/1/profile.json?identity=insurwreck-probe@example.com`,
      {
        headers: {
          "X-CleverTap-Account-Id": process.env.CLEVERTAP_ACCOUNT_ID,
          "X-CleverTap-Passcode": process.env.CLEVERTAP_PASSCODE,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    return {
      ok: r.status !== 401 && r.status !== 403,
      detail:
        `HTTP ${r.status}, region ${region}, ` +
        (allowed
          ? `${allowed} email${allowed === 1 ? "" : "s"} allowlisted`
          : "allowlist EMPTY - nobody is provisioned"),
    };
  });

  await probe("resend key works", async () => {
    if (!env("RESEND_API_KEY")) return { ok: false, detail: "no key" };
    const r = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    // A sending-only key is forbidden from listing domains, which still proves
    // the key is live. Only 401 means it is dead.
    return { ok: r.status !== 401, detail: `HTTP ${r.status}` };
  });

  await probe("n8n answers", async () => {
    if (!env("N8N_TOKEN")) return { ok: false, detail: "no token" };
    const url = process.env.N8N_MCP_URL || "https://workflow-stg.plumhq.com/mcp-server/http";
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.N8N_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(9000),
    });
    return { ok: r.ok, detail: `HTTP ${r.status}` };
  });

  await probe("vercel token works", async () => {
    if (!env("VERCEL_USER_TOKEN")) return { ok: false, detail: "no token" };
    const r = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${process.env.VERCEL_USER_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: r.ok, detail: `HTTP ${r.status}` };
  });

  try {
    const r = await fetch(`${MB()}/api/health`, { signal: AbortSignal.timeout(8000) });
    add("metabase reachable", r.ok, r.ok ? "" : `HTTP ${r.status}`);
  } catch (e) {
    add("metabase reachable", false, String(e.message).slice(0, 60));
  }

  try {
    const slices = await sb("data_slices?select=card_id&enabled=is.true");
    add("data slices published", slices.length > 0, `${slices.length} live`);
  } catch (e) {
    add("data slices published", false, "data_slices table missing");
  }

  try {
    await sb("llm_usage?select=cost_usd&limit=1");
    add("llm metering table", true, "present");
  } catch (e) {
    add("llm metering table", false, "llm_usage missing - the gateway will refuse calls");
  }

  return checks;
}

export default async function handler(req, res) {
  const who = await organizerFor(req).catch(() => null);
  if (!who) return res.status(401).json({ error: "organizer access required" });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = readBody(req);
  const action = String(body.action || "");

  try {
    switch (action) {
      case "health":
        return res.status(200).json({ ok: true, checks: await health() });

      // Raise or lower one person's model budget. Takes effect on their next
      // call - no redeploy, and they don't restart anything.
      case "set_budget": {
        const email = normalizeEmail(body.email);
        const budget = Number(body.budget_usd);
        if (!email || !Number.isFinite(budget) || budget < 0) {
          return res.status(400).json({ error: "email and a non-negative budget_usd required" });
        }
        const rows = await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic&select=payload`
        );
        if (!rows.length) return res.status(404).json({ error: "no anthropic credential for that address" });
        const payload = { ...rows[0].payload, budget_usd: budget };
        await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic`,
          { method: "PATCH", body: { payload } }
        );
        console.log(`budget for ${email} set to ${budget} by ${who}`);
        return res.status(200).json({ ok: true, email, budget_usd: budget });
      }

      // The escape hatch: give one person arbitrary read of the whole warehouse
      // when the published slices genuinely can't answer their question. This
      // removes the only real boundary for that participant, so it is per-email,
      // explicit, off by default, and every query it permits is logged.
      case "set_full_access": {
        const email = normalizeEmail(body.email);
        const enabled = Boolean(body.enabled);
        if (!email) return res.status(400).json({ error: "email required" });
        const rows = await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic&select=payload`
        );
        if (!rows.length) return res.status(404).json({ error: "no anthropic credential for that address" });
        const payload = { ...rows[0].payload, full_data_access: enabled };
        await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic`,
          { method: "PATCH", body: { payload } }
        );
        console.warn(`FULL WAREHOUSE ACCESS ${enabled ? "GRANTED to" : "revoked for"} ${email} by ${who}`);
        return res.status(200).json({ ok: true, email, full_data_access: enabled });
      }

      // Let one project see real email addresses in the claims tools. Names and
      // phone numbers stay masked for them like everyone else - this relaxes one
      // field, not the masking.
      //
      // Per-email today because a token identifies a person, not an idea. When
      // idea-to-token mapping lands, this sets the same flag for everyone on that
      // idea and unmaskEmailFor() in _claims.js reads it from there instead.
      case "set_unmask_email": {
        const email = normalizeEmail(body.email);
        const enabled = Boolean(body.enabled);
        if (!email) return res.status(400).json({ error: "email required" });
        const rows = await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic&select=payload`
        );
        if (!rows.length) return res.status(404).json({ error: "no anthropic credential for that address" });
        const payload = { ...rows[0].payload, unmask_email: enabled };
        await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic`,
          { method: "PATCH", body: { payload } }
        );
        console.warn(`CLAIMS EMAIL UNMASKING ${enabled ? "GRANTED to" : "revoked for"} ${email} by ${who}`);
        return res.status(200).json({ ok: true, email, unmask_email: enabled });
      }

      // Send someone a fresh OTP and hand the organizer the code, so a stuck
      // participant can be walked through verification over the shoulder.
      case "resend_code": {
        const email = normalizeEmail(body.email);
        if (!email) return res.status(400).json({ error: "email required" });
        const base = (process.env.DESK_BASE_URL || "").replace(/\/+$/, "");
        const r = await fetch(`${base}/api/otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-key": process.env.ADMIN_KEY || "" },
          body: JSON.stringify({ email }),
        });
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json(data);
      }

      // Who is burning budget, who has spent nothing at all (usually a sign
      // they never got started rather than that they're being frugal).
      // Cut one person's Plum data access without touching the room.
      //
      // Scoped to the anthropic credential on purpose: that row is what
      // participantFor() resolves, so revoking it closes the data MCP and the
      // model gateway for them and leaves n8n and remotion alone. A timestamp,
      // not a delete, so it is auditable and reversible.
      case "set_revoked": {
        const email = normalizeEmail(body.email);
        const revoked = Boolean(body.revoked);
        if (!email) return res.status(400).json({ error: "email required" });
        const rows = await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic&select=participant_email`
        );
        if (!rows.length) return res.status(404).json({ error: "no anthropic credential for that address" });
        await sb(
          `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.anthropic`,
          { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { revoked_at: revoked ? nowIso() : null } }
        );
        console.warn(`data access ${revoked ? "REVOKED for" : "restored for"} ${email} by ${who}`);
        return res.status(200).json({ ok: true, email, revoked });
      }

      case "spend": {
        const usage = await sbAll("llm_usage?select=participant_email,cost_usd,created_at&order=id");
        const byEmail = new Map();
        for (const row of usage) {
          const acc = byEmail.get(row.participant_email) || { email: row.participant_email, cost_usd: 0, calls: 0, last: null };
          acc.cost_usd += Number(row.cost_usd || 0);
          acc.calls += 1;
          if (!acc.last || row.created_at > acc.last) acc.last = row.created_at;
          byEmail.set(row.participant_email, acc);
        }
        return res.status(200).json({ ok: true, spend: [...byEmail.values()] });
      }

      default:
        return res.status(400).json({ error: `unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
