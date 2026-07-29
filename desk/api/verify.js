import { sb, sha256, newToken, nowIso, normalizeEmail, readBody } from "./_lib.js";

const SESSION_TTL_HOURS = 24;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = readBody(req);
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();
  if (!email.includes("@") || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "email and 6-digit code required" });
  }

  try {
    const hash = sha256(`${email}:${code}`);
    const matches = await sb(
      `otp_codes?email=eq.${encodeURIComponent(email)}&code_hash=eq.${hash}&consumed_at=is.null&expires_at=gt.${nowIso()}&select=id&limit=1`
    );
    if (!matches.length) return res.status(401).json({ error: "wrong or expired code" });

    await sb(`otp_codes?id=eq.${matches[0].id}`, {
      method: "PATCH",
      body: { consumed_at: nowIso() },
    });

    await sb("participants?on_conflict=email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { email, verified_at: nowIso() },
    });

    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600000).toISOString();
    await sb("sessions", {
      method: "POST",
      body: { token_hash: sha256(token), email, expires_at: expiresAt },
    });

    return res.status(200).json({ ok: true, token, expires_at: expiresAt });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
