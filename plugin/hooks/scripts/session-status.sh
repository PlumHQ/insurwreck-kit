#!/usr/bin/env bash
# SessionStart hook: one-line status on whether credentials are ready and
# what's still pending, so nobody has to run a command to find out.
#
# Fail-open: if anything here fails, we simply emit no message.

CREDS="$HOME/.insurwreck/credentials.json"

if [ ! -f "$CREDS" ]; then
  msg="Insurwreck: no credentials yet — run /insurwreck:start to onboard."
else
  msg="$(node -e '
    let c = {};
    try { c = require(process.argv[1]); } catch (e) {}
    const s = c.services || {};
    const need = ["vercel", "supabase", "resend", "anthropic", "agentmail"];
    const missing = need.filter((n) => !s[n]);
    const incomplete = need.filter((n) => s[n] && s[n].incomplete);
    if (!missing.length && !incomplete.length) {
      console.log("Insurwreck: all set (vercel, supabase, resend, anthropic, agentmail ready).");
    } else {
      const bits = [];
      if (missing.length) bits.push(`pending: ${missing.join(", ")}`);
      if (incomplete.length) bits.push(`still finishing: ${incomplete.join(", ")}`);
      console.log(`Insurwreck: setup incomplete — ${bits.join("; ")}. Run /insurwreck:status to refresh.`);
    }
  ' "$CREDS" 2>/dev/null)"
  [ -n "$msg" ] || msg="Insurwreck: credentials file present but unreadable — run /insurwreck:status."
fi

node -e '
  const msg = process.argv[1];
  process.stdout.write(JSON.stringify({
    systemMessage: msg,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: msg
    }
  }));
' "$msg" 2>/dev/null

exit 0
