import { sb, sha256, newOtpCode, nowIso, normalizeEmail, emailAllowed, isAdmin, readBody, resendFrom } from "./_lib.js";

const OTP_TTL_MINUTES = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const email = normalizeEmail(readBody(req).email);
  if (!email.includes("@")) return res.status(400).json({ error: "email required" });
  if (!emailAllowed(email)) {
    return res.status(403).json({ error: "This email is not allowed for the event. Use your Plum address." });
  }

  try {
    const active = await sb(
      `otp_codes?email=eq.${encodeURIComponent(email)}&consumed_at=is.null&expires_at=gt.${nowIso()}&select=id`
    );
    if (active.length >= 5) {
      return res.status(429).json({ error: "Too many active codes. Wait a few minutes and try again." });
    }

    const code = newOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000).toISOString();
    await sb("otp_codes", {
      method: "POST",
      body: { email, code_hash: sha256(`${email}:${code}`), expires_at: expiresAt },
    });

    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(),
        to: [email],
        subject: `${code} is your Insurwreck code`,
        text: [
          `Your Insurwreck 4.0 verification code is ${code}.`,
          `It expires in ${OTP_TTL_MINUTES} minutes.`,
          "",
          "Bring one real problem. Leave with a working prototype.",
          "— AI pod at Plum",
        ].join("\n"),
      }),
    });
    if (!sent.ok) {
      return res.status(502).json({ error: "email delivery failed", detail: await sent.text() });
    }

    const payload = { ok: true, sent: true, expires_in_minutes: OTP_TTL_MINUTES };
    // Test-phase convenience: organizers holding ADMIN_KEY can read the code
    // without inbox access. Harmless in prod (requires the key) but remove
    // before the event anyway.
    if (isAdmin(req)) payload.debug_code = code;
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
