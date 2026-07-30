#!/usr/bin/env bash
# Smallest check that fails if the brief gate stops gating - or starts gating
# things it must not touch.
# Run: bash plugin/hooks/scripts/test-require-brief.sh
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/require-brief.sh"
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }

# A participant project: has our CLAUDE.md marker, no BRIEF.md yet.
PROJ="$(mktemp -d)"
printf '## Brainstorm first, and only about the product\n' > "$PROJ/CLAUDE.md"

# A project without our marker - an organizer checkout, or any other repo.
PLAIN="$(mktemp -d)"
printf '# some other project\n' > "$PLAIN/CLAUDE.md"

trap 'rm -rf "$PROJ" "$PLAIN"' EXIT

call() { # call <cwd> <file_path>
  printf '{"cwd":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2" | bash "$HOOK"
}
denied() { printf '%s' "$1" | grep -q '"permissionDecision":"deny"'; }

# --- source files are blocked before a brief exists ------------------------
for f in app/page.tsx lib/db.ts api/route.js main.py server.go app/x.svelte; do
  denied "$(call "$PROJ" "$PROJ/$f")" && ok || bad "$f should be blocked with no BRIEF.md"
done

# --- the escape hatch must be writable, or the gate is a dead end ----------
for f in BRIEF.md README.md package.json app/globals.css .env.local data/seed.json; do
  [ -z "$(call "$PROJ" "$PROJ/$f")" ] && ok || bad "$f must stay writable"
done

# --- dependencies and build output are never our business -----------------
for f in node_modules/react/index.js .next/server/app.js dist/bundle.js; do
  [ -z "$(call "$PROJ" "$PROJ/$f")" ] && ok || bad "$f must be ignored"
done

# --- a project without our marker is untouched ----------------------------
[ -z "$(call "$PLAIN" "$PLAIN/app/page.tsx")" ] && ok \
  || bad "a project without our CLAUDE.md marker must never be gated"

# --- once briefed, silent forever -----------------------------------------
printf 'the brief\n' > "$PROJ/BRIEF.md"
[ -z "$(call "$PROJ" "$PROJ/app/page.tsx")" ] && ok \
  || bad "must go quiet once BRIEF.md exists"
rm -f "$PROJ/BRIEF.md"

# --- malformed input fails open ------------------------------------------
for payload in '' 'not json' '{}' '{"cwd":"/nope","tool_input":{}}'; do
  [ -z "$(printf '%s' "$payload" | bash "$HOOK")" ] && ok \
    || bad "malformed input must fail open: $payload"
done

# --- the denial has to tell the model what to do -------------------------
msg="$(call "$PROJ" "$PROJ/app/page.tsx")"
printf '%s' "$msg" | grep -q 'BRIEF.md' && ok || bad "denial must name BRIEF.md"
printf '%s' "$msg" | grep -qi 'frameworks' && ok || bad "denial must rule out technical questions"

# --- both installers must write the marker the hook greps for -------------
# The gate is a no-op in any project whose CLAUDE.md lacks this line, so if an
# installer stops writing it the hook goes quiet and nothing tells you.
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
for inst in "$REPO/desk/public/go.sh" "$REPO/desk/public/go.ps1"; do
  if grep -qF "Brainstorm first, and only about the product" "$inst" 2>/dev/null; then
    ok
  else
    bad "$(basename "$inst") no longer writes the CLAUDE.md marker - the gate is inert for anyone it sets up"
  fi
done

echo "brief gate: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
