import { sb, organizerFor } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!(await organizerFor(req))) return res.status(401).json({ error: "organizer access required" });

  try {
    const participants = await sb(
      "participants?select=name,email,idea_brief,agent,verified_at,provisioned_at,created_at&order=created_at.asc"
    );
    const credentials = await sb(
      "credentials?select=participant_email,service,minted_live,created_at&revoked_at=is.null&order=created_at.asc"
    );

    // Model spend per participant, so organizers can see who is close to their
    // budget before they hit the wall rather than after.
    let spend = [];
    try {
      const usage = await sb("llm_usage?select=participant_email,cost_usd,input_tokens,output_tokens");
      const byEmail = new Map();
      for (const row of usage) {
        const e = row.participant_email;
        const acc = byEmail.get(e) || { participant_email: e, cost_usd: 0, calls: 0, tokens: 0 };
        acc.cost_usd += Number(row.cost_usd || 0);
        acc.tokens += Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
        acc.calls += 1;
        byEmail.set(e, acc);
      }
      spend = [...byEmail.values()].map((s) => ({ ...s, cost_usd: Number(s.cost_usd.toFixed(4)) }));
    } catch (error) {
      console.error("llm_usage unavailable for roster:", error.message);
    }

    return res.status(200).json({ participants, credentials, spend });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
