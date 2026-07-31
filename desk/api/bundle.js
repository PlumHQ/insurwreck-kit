import { sb, sha256 } from "./_lib.js";

// Re-issue a participant's credential bundle to the participant themselves.
//
// Refreshing the bundle used to mean a fresh OTP, because the desk keeps no
// session on disk. That is the right answer for provisioning, and far too
// heavy for "the desk minted something for me since I onboarded" - which is
// exactly what happens when an organizer repairs someone, or when a service
// that was pending for the whole room comes good at once.
//
// Their `iwk-` token is already a per-participant secret they hold and already
// authenticates them to the data server and the model gateway, so it is the
// natural key here. Read-only: this mints nothing and changes nothing.
const SERVICES = [
  "vercel", "supabase", "n8n", "resend", "agentmail",
  "anthropic", "google_auth", "kula", "zendesk",
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "missing token" });

  try {
    const owner = await sb(
      `credentials?service=eq.anthropic&revoked_at=is.null` +
        `&payload->>token_hash=eq.${sha256(token)}` +
        `&select=participant_email&limit=1`
    );
    if (!owner.length) return res.status(401).json({ error: "invalid token" });
    const email = owner[0].participant_email;

    const rows = await sb(
      `credentials?participant_email=eq.${encodeURIComponent(email)}` +
        `&revoked_at=is.null&select=service,payload`
    );
    const people = await sb(
      `participants?email=eq.${encodeURIComponent(email)}&select=name,email,idea_brief,agent&limit=1`
    );

    const services = Object.fromEntries(rows.map((r) => [r.service, r.payload]));
    return res.status(200).json({
      ok: true,
      participant: people[0] || { email },
      services,
      pending: SERVICES.filter((s) => !services[s]),
    });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
