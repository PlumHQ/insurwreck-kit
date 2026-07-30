import { sb, newToken, participantEmail } from "./_lib.js";
import { authorizeUrl, kekaConfigured, redirectUri } from "./_keka.js";

const STATE_TTL_MINUTES = 10;

// Starts the Keka OAuth flow for the caller. Auth is the participant's own
// INSURWRECK_TOKEN, so the state is bound to an email the desk already knows —
// a leaked callback URL cannot attach someone else's Keka account.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!kekaConfigured()) {
    return res.status(503).json({ error: "Keka OAuth is not configured on the desk yet" });
  }

  try {
    const email = await participantEmail(req);
    if (!email) return res.status(401).json({ error: "Invalid or missing token." });

    const state = newToken();
    await sb("keka_oauth_states", {
      method: "POST",
      body: {
        state,
        email,
        expires_at: new Date(Date.now() + STATE_TTL_MINUTES * 60000).toISOString(),
      },
    });

    const connected = await sb(
      `keka_tokens?email=eq.${encodeURIComponent(email)}&select=updated_at&limit=1`
    );

    return res.status(200).json({
      ok: true,
      authorize_url: authorizeUrl(state),
      redirect_uri: redirectUri(),
      expires_in: STATE_TTL_MINUTES * 60,
      already_connected: connected.length > 0,
      connected_at: connected[0]?.updated_at || null,
      next: "Open authorize_url in a browser, log in to Keka, and approve access.",
    });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
