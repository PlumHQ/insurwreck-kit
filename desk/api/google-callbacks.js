import { sb, isAdmin, nowIso } from "./_lib.js";

// Google has no public API for an OAuth client's authorized redirect URIs, so
// organizers paste them into the console in batches. GET produces the list;
// POST marks everything currently issued as registered, which clears the
// participants' google_console_registration pending part.
export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: "admin key required" });

  try {
    const rows = await sb(
      "credentials?service=eq.google_auth&revoked_at=is.null&select=id,participant_email,payload&order=created_at.asc"
    );

    if (req.method === "GET") {
      const all = [];
      const unregistered = [];
      for (const row of rows) {
        const uri = row.payload?.callback_url;
        if (!uri) continue;
        all.push(uri);
        if (!row.payload?.console_registered) {
          unregistered.push({ email: row.participant_email, redirect_uri: uri });
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
