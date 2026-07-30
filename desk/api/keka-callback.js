import { sb, nowIso } from "./_lib.js";
import { exchangeCode } from "./_keka.js";

// Keka redirects the participant's browser here after they log in and approve.
// The code is worth an access token, so the state must be present, unexpired,
// and unused — consumed before the exchange so a replayed callback is inert.
function page(title, detail) {
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<body style="font:16px/1.5 ui-monospace,monospace;max-width:34rem;margin:12vh auto;padding:0 1.5rem">
<h1 style="font-size:1.1rem">${esc(title)}</h1><p>${esc(detail)}</p></body>`;
}

export default async function handler(req, res) {
  const send = (status, title, detail) =>
    res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(page(title, detail));

  const { code, state, error, error_description: errorDescription } = req.query || {};
  if (error) return send(400, "Keka declined the request", errorDescription || String(error));
  if (!code || !state) return send(400, "Missing code or state", "Start again with /insurwreck:keka-connect.");

  try {
    const rows = await sb(
      `keka_oauth_states?state=eq.${encodeURIComponent(String(state))}&consumed_at=is.null&expires_at=gt.${nowIso()}&select=email&limit=1`
    );
    if (!rows.length) {
      return send(401, "Link expired", "That connect link is used or older than 10 minutes. Run /insurwreck:keka-connect again.");
    }
    await sb(`keka_oauth_states?state=eq.${encodeURIComponent(String(state))}`, {
      method: "PATCH",
      body: { consumed_at: nowIso() },
    });

    await exchangeCode(rows[0].email, String(code));
    return send(200, "Keka connected", `${rows[0].email} is linked. Close this tab and return to Claude Code.`);
  } catch (err) {
    return send(500, "Could not connect Keka", String(err.message || err));
  }
}
