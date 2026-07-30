#!/usr/bin/env bash
# PreToolUse hook (Bash): block real credentials pasted into tracked source
# before they're staged or committed. .env* files are already git-ignored —
# this catches the "paste the key straight into lib/supabase.ts" mistake.
#
# Fail-open: this script only ever blocks via a deliberate JSON "deny" below.
# Any internal error (missing node, bad JSON, git failure) falls through to
# exit 0 — never blocks a participant's work because of a hook bug.

raw="$(cat)"

get() {
  printf '%s' "$raw" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      let j={}; try { j = JSON.parse(d); } catch (e) {}
      const path = '$1'.split('.');
      let v = j; for (const k of path) v = v && v[k];
      process.stdout.write(String(v || ''));
    });" 2>/dev/null
}

cmd="$(get tool_input.command)"
[ -n "$cmd" ] || exit 0

case "$cmd" in
  *git\ add*|*git\ commit*) ;;
  *) exit 0 ;;
esac

# Known secret shapes: Supabase JWTs (eyJ...), Supabase PATs (sbp_), Resend
# keys (re_), our proxy tokens (iwk-), and generic bearer-token literals.
PATTERN='eyJ[A-Za-z0-9_-]{10,}|sbp_[A-Za-z0-9]{15,}|re_[A-Za-z0-9]{15,}|iwk-[A-Za-z0-9]{8,}|[Bb]earer [A-Za-z0-9._-]{20,}'

hits=""

case "$cmd" in
  *git\ commit*)
    files=$(git diff --cached --name-only 2>/dev/null)
    for f in $files; do
      [ -f "$f" ] || continue
      m=$(git diff --cached -U0 -- "$f" 2>/dev/null | grep -E '^\+' | grep -Ev '^\+\+\+' | grep -Eq "$PATTERN" && echo yes)
      [ "$m" = "yes" ] && hits="$hits $f"
    done
    ;;
  *git\ add*)
    files=$(git status --porcelain --untracked-files=all 2>/dev/null | awk '{print $2}')
    for f in $files; do
      [ -f "$f" ] || continue
      grep -Eq "$PATTERN" "$f" 2>/dev/null && hits="$hits $f"
    done
    ;;
esac

[ -n "$hits" ] || exit 0

reason="Looks like a real credential is hardcoded in tracked source (not in .env):$hits. Move it into .env / .env.local instead — those are already git-ignored. A key committed to git stays recoverable in history forever, even after you delete the line later."

node -e '
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: process.argv[1]
    }
  }));
' "$reason" 2>/dev/null

exit 0
