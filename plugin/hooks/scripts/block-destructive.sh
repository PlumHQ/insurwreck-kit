#!/usr/bin/env bash
# PreToolUse hook (Bash): block commands that destroy work with no undo —
# rm -rf outside the project, git reset --hard, git checkout --.
#
# Fail-open: only blocks via a deliberate JSON "deny" below. Any internal
# error falls through to exit 0 — never blocks by accident. This is a
# best-effort heuristic on the command string, not a full shell parser —
# it catches the direct, common forms, not deliberately obfuscated ones.

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
cwd="$(get cwd)"
[ -n "$cmd" ] || exit 0

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

if [[ "$cmd" =~ git[[:space:]]+reset[[:space:]]+.*--hard ]]; then
  deny "This throws away every uncommitted local change with no undo. If you meant to fix something specific, tell me what — the auto-checkpoint commits already give you a safe way back, no need for --hard."
fi

if [[ "$cmd" =~ git[[:space:]]+checkout[[:space:]]+-- ]]; then
  deny "This discards uncommitted changes to a file with no undo. Ask me to restore from a checkpoint commit if you want an earlier version back instead."
fi

if [[ "$cmd" =~ rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive[[:space:]]+--force|--force[[:space:]]+--recursive) ]]; then
  if [[ "$cmd" =~ (^|[[:space:]])(~|\$HOME)([[:space:]]|$) ]] || [[ "$cmd" =~ (^|[[:space:]])/([[:space:]]|$) ]]; then
    deny "This targets your whole home folder or the entire disk — that deletes far more than this project, so I'm not running it. Tell me exactly which folder inside the project you want removed."
  fi
  if [ -n "$cwd" ]; then
    for tok in $cmd; do
      case "$tok" in
        /*)
          case "$tok" in
            "$cwd"|"$cwd"/*) : ;;
            *) deny "This targets \"$tok\", which is outside this project folder ($cwd). I'm not running a recursive delete outside the project — tell me the exact path inside it if that's what you meant." ;;
          esac
          ;;
      esac
    done
  fi
fi

exit 0
