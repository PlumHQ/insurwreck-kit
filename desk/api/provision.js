import { sb, sha256, nowIso, readBody, resendFrom } from "./_lib.js";

const SERVICES = ["vercel", "supabase", "n8n", "resend", "agentmail"];

async function sessionEmail(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const rows = await sb(
    `sessions?token_hash=eq.${sha256(token)}&expires_at=gt.${nowIso()}&select=email&limit=1`
  );
  return rows.length ? rows[0].email : null;
}

// The one credential the desk can mint live today: a sending-only Resend key
// on the shared hackathon domain. Everything else is pre-provisioned by
// organizers into the credentials table.
async function mintResendKey(email) {
  const response = await fetch("https://api.resend.com/api-keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: `insurwreck-${email}`, permission: "sending_access" }),
  });
  if (!response.ok) {
    throw new Error(`resend key mint failed: ${response.status} ${await response.text()}`);
  }
  const key = await response.json();
  return {
    api_key: key.token,
    key_id: key.id,
    from: resendFrom(),
    note: "Sending-only Resend key for the shared hackathon domain.",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const email = await sessionEmail(req);
    if (!email) {
      return res.status(401).json({ error: "invalid or expired session — verify your email again" });
    }

    const body = readBody(req);
    const patch = { provisioned_at: nowIso() };
    if (body.name) patch.name = String(body.name).slice(0, 120);
    if (body.idea_brief) patch.idea_brief = String(body.idea_brief).slice(0, 2000);
    if (body.agent) patch.agent = String(body.agent).slice(0, 40);
    const updated = await sb(`participants?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: patch,
    });
    const participant = updated[0] || { email };

    let rows = await sb(
      `credentials?participant_email=eq.${encodeURIComponent(email)}&revoked_at=is.null&select=service,payload,minted_live`
    );

    if (!rows.some((row) => row.service === "resend")) {
      try {
        const payload = await mintResendKey(email);
        await sb("credentials", {
          method: "POST",
          body: { participant_email: email, service: "resend", payload, minted_live: true },
        });
        rows = [...rows, { service: "resend", payload, minted_live: true }];
      } catch (mintError) {
        console.error(mintError); // provision still succeeds; resend stays pending
      }
    }

    const services = Object.fromEntries(rows.map((row) => [row.service, row.payload]));
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
