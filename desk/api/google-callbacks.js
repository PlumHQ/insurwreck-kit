import { sb, organizerFor, nowIso } from "./_lib.js";
import { callbackRegistered } from "./_minters.js";

// Google has no public API for an OAuth client's authorized redirect URIs, so
// organizers paste them into the console in batches. GET produces the list;
// POST marks everything currently issued as registered, which clears the
// participants' google_console_registration pending part.
export default async function handler(req, res) {
  if (!(await organizerFor(req))) return res.status(401).json({ error: "organizer access required" });

  try {
    const rows = await sb(
      "credentials?service=eq.google_auth&revoked_at=is.null&select=id,participant_email,payload&order=created_at.asc"
    );

    if (req.method === "GET") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const all = [];
      const unregistered = [];

      // Probe Google live rather than trusting the stored flag, and persist
      // anything that has since been registered.
      const checked = await Promise.all(
        rows.map(async (row) => {
          const uri = row.payload?.callback_url;
          if (!uri) return null;
          if (row.payload?.console_registered) return { row, uri, live: true };
          // Three, not the default two. This sweep runs right after an organizer
          // pastes a batch, which is the worst moment to trust a probe: the URIs
          // are mid-propagation, and the flag it writes is sticky - the branch
          // above never re-checks a row once it says true. More agreement lowers
          // the odds of latching early; it does not remove them, so a team that
          // still reports mismatch after this needs the row cleared, not a retry.
          const live = await callbackRegistered(clientId, uri, 3);
          if (live) {
            const payload = { ...row.payload, console_registered: true, registered_at: nowIso() };
            delete payload.incomplete;
            delete payload.pending_parts;
            await sb(`credentials?id=eq.${row.id}`, { method: "PATCH", body: { payload } });
          }
          return { row, uri, live };
        })
      );

      for (const entry of checked) {
        if (!entry) continue;
        all.push(entry.uri);
        if (!entry.live) {
          unregistered.push({ email: entry.row.participant_email, redirect_uri: entry.uri });
        }
      }

      return res.status(200).json({
        total: all.length,
        unregistered_count: unregistered.length,
        unregistered,
        // Paste-ready block for the Google Cloud console credentials screen.
        all_redirect_uris: all,
        paste_block: all.join("\n"),
        console_url: `https://console.cloud.google.com/apis/credentials?project=${
          process.env.GOOGLE_PROJECT_ID || "insurwreck-leads"
        }`,
      });
    }

    if (req.method === "POST") {
      const marked = [];
      for (const row of rows) {
        if (row.payload?.console_registered || !row.payload?.callback_url) continue;
        const payload = { ...row.payload, console_registered: true, registered_at: nowIso() };
        delete payload.incomplete;
        delete payload.pending_parts;
        await sb(`credentials?id=eq.${row.id}`, { method: "PATCH", body: { payload } });
        marked.push(row.participant_email);
      }
      return res.status(200).json({ ok: true, marked_registered: marked });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
