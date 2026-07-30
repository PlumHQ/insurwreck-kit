import { sb, nowIso, readBody, organizerFor } from "./_lib.js";

// Organizer-only. Publish a Metabase saved question to participants, or pull it
// back, without a redeploy.
//
// The flow on the day: write the SQL in Metabase, save it into the Insurwreck
// collection, copy the card id out of the URL, POST it here. It's live on the
// next MCP call - no deploy, no env var, no restart for participants.

export default async function handler(req, res) {
  if (!(await organizerFor(req))) return res.status(401).json({ error: "organizer access required" });

  try {
    if (req.method === "GET") {
      const slices = await sb("data_slices?select=*&order=created_at.desc");
      return res.status(200).json({ ok: true, slices });
    }

    if (req.method === "POST") {
      const body = readBody(req);
      const cardId = parseInt(body.card_id, 10);
      if (!Number.isInteger(cardId)) {
        return res.status(400).json({ error: "card_id must be a number" });
      }

      // Confirm the card exists and is readable before publishing it, so a typo
      // surfaces here rather than as a broken tool in someone's session.
      const probe = await fetch(
        `${(process.env.METABASE_URL || "https://stats2.plumhq.com").replace(/\/+$/, "")}/api/card/${cardId}`,
        { headers: { "x-api-key": process.env.METABASE_API_KEY || "" } }
      );
      if (!probe.ok) {
        return res.status(400).json({
          error: `Metabase says card ${cardId} isn't readable (${probe.status}). Check the id, and that the service account can see its collection.`,
        });
      }
      const card = await probe.json();

      const row = {
        card_id: cardId,
        name: body.name || card.name,
        note: body.note || null,
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        created_at: nowIso(),
      };

      await sb("data_slices?on_conflict=card_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: row,
      });

      return res.status(200).json({ ok: true, slice: row, metabase_name: card.name });
    }

    if (req.method === "DELETE") {
      const cardId = parseInt(readBody(req).card_id || req.query?.card_id, 10);
      if (!Number.isInteger(cardId)) {
        return res.status(400).json({ error: "card_id must be a number" });
      }
      await sb(`data_slices?card_id=eq.${cardId}`, {
        method: "PATCH",
        body: { enabled: false },
      });
      return res.status(200).json({ ok: true, disabled: cardId });
    }

    return res.status(405).json({ error: "GET, POST or DELETE" });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
