#!/usr/bin/env bash
#
# Be a participant for ten minutes.
#
#   test/dryrun.sh            fresh box, run the real installer, hand you Claude Code
#   test/dryrun.sh --keep     reuse the last box, so you don't redo login/onboarding
#   test/dryrun.sh --reset    throw the kept box away
#
# This is the actual go.sh a participant pastes, against the local checkout, on a
# machine with no node, npm or git. Nothing here is a mock. What you see is what
# they get - except Ghostty, which needs a desktop and can't render in a container.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="insurwreck-rehearsal"
VOLUME="insurwreck-dryrun-home"
MODE="${1:-}"

command -v docker >/dev/null 2>&1 || { echo "Docker isn't running - start Docker Desktop." >&2; exit 1; }

if [ "$MODE" = "--reset" ]; then
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  echo "Dry-run box reset. Next run starts clean."
  exit 0
fi

echo "Building the bare machine (no node, no npm, no git)…"
docker build -q -t "$IMAGE" "$REPO_ROOT/test" >/dev/null

# A named volume keeps $HOME between runs, so a --keep session still has your
# Claude login and credential bundle. Without it every run is a virgin machine.
docker volume create "$VOLUME" >/dev/null

FIRSTRUN=1
if [ "$MODE" = "--keep" ] && docker run --rm -v "$VOLUME:/home/leader" "$IMAGE" \
      test -x /home/leader/.local/bin/claude 2>/dev/null; then
  FIRSTRUN=0
  echo "Reusing the existing box (--reset to start over)."
fi

cat <<EOF

  ──────────────────────────────────────────────────────────────
   You are now a hackathon participant on a brand-new machine.

   $( [ "$FIRSTRUN" = "1" ] && echo "The installer runs first - watch what they'd watch." || echo "Box already set up - dropping you straight in." )

   Once you're at the Claude prompt, do what they'd do:

     1. /login              (once, with your Claude account)
     2. /insurwreck:start   (the real thing - real email, real code)
     3. "I want to build a claims dashboard"
     4. iw-doctor
     5. ask it: "show me what Plum data I can query"

   Type  exit  to leave. Your progress is kept for --keep.
  ──────────────────────────────────────────────────────────────

EOF

docker run --rm -it \
  -v "$REPO_ROOT:/kit:ro" \
  -v "$VOLUME:/home/leader" \
  -e INSURWRECK_MARKETPLACE=/home/leader/kit \
  -e FIRSTRUN="$FIRSTRUN" \
  "$IMAGE" bash -lc '
    set -uo pipefail
    export PATH="$HOME/.local/bin:$PATH"

    if [ "$FIRSTRUN" = "1" ]; then
      # marketplace add needs a writable source, and /kit is mounted read-only.
      rm -rf "$HOME/kit"; cp -r /kit "$HOME/kit"; chmod -R u+w "$HOME/kit"
      bash "$HOME/kit/desk/public/go.sh" --no-ghostty --no-launch
    else
      # Refresh the kit copy so edits since the last run are picked up.
      rm -rf "$HOME/kit"; cp -r /kit "$HOME/kit"; chmod -R u+w "$HOME/kit"
      claude plugin marketplace update insurwreck-kit >/dev/null 2>&1 || true
    fi

    cd "$HOME/insurwreck" 2>/dev/null || cd "$HOME"
    echo
    echo "Starting Claude Code…"
    exec claude
  '
