#!/usr/bin/env bash
# PreToolUse hook (mcp__kula__*): Kula is read-only. No writes, no exceptions.
#
# Why this is a hook and not a paragraph in a command file: the key issued for
# this event is the Application API type - "full access" in Kula's own docs - and
# Kula has no OAuth, so ONE key is shared by every participant. Without this,
# all ~25 people hold write access to the real recruiting pipeline: creating
# candidates, editing profiles, moving real applications between stages. "We told
# them not to" is not a control, and there is no read-only key type available to
# fall back on.
#
# There is deliberately no override. If a project needs to write, it writes to
# its own Supabase and shows that in the demo.
#
# Allow-by-verb rather than deny-by-name: Kula's read tools are list_*, get_*,
# search_* and autocomplete_*. Anything else is treated as a write and blocked,
# so a new write tool in a future @kula-ai/mcp-server release is blocked the day
# it ships rather than the day someone notices.
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

# Strip the mcp__kula__ prefix to get the bare tool name.
name="${tool##*__}"

case "$name" in
  list_*|get_*|search_*|autocomplete_*)
    exit 0 ;;
esac

# Specific reasons for the tools people will actually reach for, so the block
# teaches rather than just refuses.
case "$name" in
  create_candidate|update_candidate)
    deny "Kula is read-only for this event. This would create or edit a real candidate record, and the Kula key is shared by every participant - so it changes live data Plum's recruiters depend on. Everything you need to read works: search_candidates, get_candidate, list_applications. Write your changes to your own Supabase and show that in the demo." ;;
  update_application_stage)
    deny "Kula is read-only for this event. This would move a real person's job application to a different stage. Read the pipeline with list_applications and model the stage change in your own Supabase - your demo can show the transition without touching live recruiting data." ;;
  create_application_note|update_application_note)
    deny "Kula is read-only for this event. This would write a note onto a real application where a recruiter would read it. Keep generated notes in your own database and display them from there." ;;
  create_webhook|update_webhook|delete_webhook)
    deny "Kula is read-only for this event, and webhooks are shared across all participants - one change here can silently break someone else's project. If your idea needs Kula events, poll the read tools instead." ;;
  create_job_stage|create_requisition|update_requisition)
    deny "Kula is read-only for this event. This would change hiring pipeline configuration for the whole organisation. Read the existing setup with list_jobs and list_job_stages and build around it." ;;
esac

deny "Kula is read-only for this event, and \"$name\" isn't one of its read tools (list_*, get_*, search_*, autocomplete_*). The Kula key is shared by every participant, so writes would change live recruiting data. If you need to persist something, write it to your own Supabase."
