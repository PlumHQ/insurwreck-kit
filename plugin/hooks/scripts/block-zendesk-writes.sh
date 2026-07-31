#!/usr/bin/env bash
# PreToolUse hook (mcp__zendesk__*): Zendesk is read-only. No writes, no exceptions.
#
# Same reasoning as block-kula-writes.sh, with a sharper edge. Zendesk API tokens
# authenticate an account rather than a person, so ONE token is shared by every
# participant - and it points at the real support desk. zd-mcp-server exposes
# zendesk_add_public_note, which does not just edit a record: it emails the reply
# to the customer who filed the ticket. There is no undo for that.
#
# There is deliberately no override. If a project needs to write a reply, it
# writes it to its own Supabase and shows that in the demo.
#
# Allow-by-verb rather than deny-by-name: zd-mcp-server's read tools are
# zendesk_search and zendesk_get_*. Anything else is treated as a write and
# blocked, so a new write tool in a future release is blocked the day it ships.
#
# Fail-open on error by design: only the explicit JSON "deny" below blocks, and
# any internal failure falls through to exit 0. A broken hook must not stop
# someone's build day.

raw="$(cat)"

tool="$(printf '%s' "$raw" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    let j={}; try { j = JSON.parse(d); } catch (e) {}
    process.stdout.write(String(j.tool_name || ''));
  });" 2>/dev/null)"

[ -n "$tool" ] || exit 0

deny() {
  node -e '
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: process.argv[1]
      }
    }));
  ' "$1" 2>/dev/null
  exit 0
}

# Strip the mcp__zendesk__ prefix. The bare tool names are themselves prefixed
# with zendesk_, so mcp__zendesk__zendesk_search arrives here as zendesk_search.
name="${tool##*__}"

case "$name" in
  zendesk_search|zendesk_get_*)
    exit 0 ;;
esac

case "$name" in
  zendesk_add_public_note)
    deny "Zendesk is read-only for this event, and this one is the reason why: a public note is emailed to the customer who filed the ticket. The Zendesk token is shared by every participant and points at Plum's real support desk. Read with zendesk_search and zendesk_get_ticket_details, and keep any reply you generate in your own Supabase so the demo can show it without sending it." ;;
  zendesk_add_private_note)
    deny "Zendesk is read-only for this event. An internal note still lands in a real ticket that a support agent will read, and the token is shared by all participants. Store generated notes in your own Supabase and display them from there." ;;
  zendesk_create_ticket)
    deny "Zendesk is read-only for this event. This would create a real ticket in Plum's support queue and put it in front of an agent. Model the ticket in your own Supabase instead - reading the real queue with zendesk_search gives you the shape to copy." ;;
  zendesk_update_ticket)
    deny "Zendesk is read-only for this event. This would change status, priority or assignee on a live customer ticket that someone is working. Read it with zendesk_get_ticket_details and model the change in your own database." ;;
esac

deny "Zendesk is read-only for this event, and \"$name\" isn't one of its read tools (zendesk_search, zendesk_get_*). The token is shared by every participant and points at the real support desk, so writes reach live tickets and their customers. If you need to persist something, write it to your own Supabase."
