import { sb, sha256, nowIso, readBody, isAdmin, normalizeEmail } from "./_lib.js";
import {
  mintResend,
  mintVercel,
  mintSupabase,
  mintAgentmail,
  mintAnthropic,
  mintN8n,
  mintGoogleAuth,
  mintKula,
  mintZendesk,
} from "./_minters.js";

const SERVICES = [
  "vercel",
  "supabase",
  "n8n",
  "resend",
  "agentmail",
  "anthropic",
  "google_auth",
  "kula",
  "zendesk",
];

// Every service has a minter now. One that throws - usually a missing env var -
// leaves that service pending and the next provision call repairs it.
// google_auth runs last: it needs the participant's Supabase project ref and
// Vercel project name, so both of those must have minted first.
const MINTERS = {
  resend: mintResend,
  vercel: mintVercel,
  supabase: mintSupabase,
  agentmail: mintAgentmail,
  anthropic: mintAnthropic,
  n8n: mintN8n,
  google_auth: mintGoogleAuth,
  kula: mintKula,
  zendesk: mintZendesk,
};

async function sessionEmail(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const rows = await sb(
    `sessions?token_hash=eq.${sha256(token)}&expires_at=gt.${nowIso()}&select=email&limit=1`
  );
  return rows.length ? rows[0].email : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = readBody(req);
    // Organizers can repair a participant's setup without making them
    // re-verify: admin key plus the participant's email.
    const email = isAdmin(req) && body.email
      ? normalizeEmail(body.email)
      : await sessionEmail(req);
    if (!email) {
      return res.status(401).json({ error: "invalid or expired session — verify your email again" });
    }

    const patch = { provisioned_at: nowIso() };
    if (body.name) patch.name = String(body.name).slice(0, 120);
    if (body.idea_brief) patch.idea_brief = String(body.idea_brief).slice(0, 2000);
    if (body.agent) patch.agent = String(body.agent).slice(0, 40);
    const updated = await sb(`participants?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: patch,
    });
    const participant = updated[0] || { email };

    const rows = await sb(
      `credentials?participant_email=eq.${encodeURIComponent(email)}&revoked_at=is.null&select=service,payload,minted_live`
    );
    const byService = new Map(rows.map((row) => [row.service, row]));

    // Mint anything missing; repair anything incomplete (e.g. Supabase keys
    // that weren't ready on the first pass, or a Vercel token once a
    // personal-scope PAT lands in the environment). Failures never sink the
    // whole provision — the service just stays pending for the next run.
    for (const [service, minter] of Object.entries(MINTERS)) {
      const row = byService.get(service);
      if (row && !row.payload?.incomplete) continue;
      try {
        const context = Object.fromEntries(
          [...byService.values()].map((entry) => [entry.service, entry.payload])
        );
        const payload = await minter(email, row?.payload || {}, context);
        if (row) {
          await sb(
            `credentials?participant_email=eq.${encodeURIComponent(email)}&service=eq.${service}`,
            { method: "PATCH", body: { payload, minted_live: true } }
          );
        } else {
          await sb("credentials", {
            method: "POST",
            body: { participant_email: email, service, payload, minted_live: true },
          });
        }
        byService.set(service, { service, payload, minted_live: true });
      } catch (error) {
        console.error(`mint ${service} failed for ${email}:`, error);
      }
    }

    const services = Object.fromEntries(
      [...byService.values()].map((row) => [row.service, row.payload])
    );
    const pending = SERVICES.filter((service) => !services[service]);
    return res.status(200).json({
      ok: true,
      participant: {
        name: participant.name,
        email: participant.email,
        idea_brief: participant.idea_brief,
        agent: participant.agent,
      },
      services,
      pending,
    });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
