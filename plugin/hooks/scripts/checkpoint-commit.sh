#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): quiet auto-checkpoint commit, so a
# non-engineer gets an undo they never had to learn git for.
#
# - Only runs when the cwd is a git repo.
# - Debounced: at most one checkpoint per MIN_INTERVAL seconds, so a burst
#   of edits doesn't spam commits.
# - Never fails the tool call: always exits 0, all output silenced.

{
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

  gitdir="$(git rev-parse --git-dir 2>/dev/null)" || exit 0
  lock="$gitdir/iw-checkpoint-last"
  now=$(date +%s)

  last=0
  [ -f "$lock" ] && last="$(cat "$lock" 2>/dev/null)"
  case "$last" in ''|*[!0-9]*) last=0 ;; esac

  MIN_INTERVAL=20
  if [ $((now - last)) -lt "$MIN_INTERVAL" ]; then
    exit 0
  fi

  git add -A >/dev/null 2>&1 || exit 0
  git diff --cached --quiet 2>/dev/null && exit 0   # nothing new to save

  git commit --quiet -m "checkpoint: auto-save $(date '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1
  echo "$now" > "$lock" 2>/dev/null
} >/dev/null 2>&1

exit 0
