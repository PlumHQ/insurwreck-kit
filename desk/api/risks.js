import { sb, sbAll, organizerFor, participantFor, nowIso, readBody } from "./_lib.js";

// The shared, cross-participant view of every flagged export/download
// request. Each participant's own Supabase project holds the same-shaped
// table for their own copy — this is just where the organizer console reads
// from. Logging happens on the honour system (CLAUDE.md tells Claude Code to
// POST here), not enforcement, so this endpoint only ever records and
// surfaces, never blocks.
export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const participant = await participantFor(req);
      if (!participant) return res.status(401).json({ error: "participant access required" });

      const body = readBody(req);
      const request_text = String(body.request_text || "").trim().slice(0, 500);
      if (!request_text) return res.status(400).json({ error: "request_text required" });

      await sb("risks", {
        method: "POST",
        body: { participant_email: participant.email, request_text },
      });
      return res.status(200).json({ ok: true });
    }

    const organizer = await organizerFor(req);
    if (!organizer) return res.status(401).json({ error: "organizer access required" });

    if (req.method === "GET") {
      const risks = await sbAll(
        "risks?select=id,participant_email,request_text,created_at,reviewed_at,reviewed_by&order=created_at.desc"
      );
      const participants = await sb("participants?select=email,name");
      const nameByEmail = new Map(participants.map((p) => [p.email, p.name]));
      const withNames = risks.map((r) => ({ ...r, name: nameByEmail.get(r.participant_email) || null }));
      return res.status(200).json({ risks: withNames });
    }

    if (req.method === "PATCH") {
      const body = readBody(req);
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "id required" });
      const reviewed = Boolean(body.reviewed);
      await sb(`risks?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { reviewed_at: reviewed ? nowIso() : null, reviewed_by: reviewed ? organizer : null },
      });
      return res.status(200).json({ ok: true, id, reviewed });
    }

    return res.status(405).json({ error: "GET, POST, or PATCH only" });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
