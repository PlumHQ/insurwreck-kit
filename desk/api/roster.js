import { sb, isAdmin } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!isAdmin(req)) return res.status(401).json({ error: "admin key required" });

  try {
    const participants = await sb(
      "participants?select=name,email,idea_brief,agent,verified_at,provisioned_at,created_at&order=created_at.asc"
    );
    const credentials = await sb(
      "credentials?select=participant_email,service,minted_live,created_at&revoked_at=is.null&order=created_at.asc"
    );
    return res.status(200).json({ participants, credentials });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
