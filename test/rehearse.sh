#!/usr/bin/env bash
#
# Rehearse the participant experience on a bare machine.
#
#   test/rehearse.sh            run the checks, print a verdict
#   test/rehearse.sh --shell    drop into the container afterwards to poke around
#
# Builds a clean Ubuntu box with no node/npm/git, runs the real go.sh against a
# local checkout of this repo, and asserts the things that would ruin the morning.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="insurwreck-rehearsal"
SHELL_AFTER=0
[ "${1:-}" = "--shell" ] && SHELL_AFTER=1

command -v docker >/dev/null 2>&1 || { echo "docker isn't running" >&2; exit 1; }

echo "Building the bare machine…"
docker build -q -t "$IMAGE" "$REPO_ROOT/test" >/dev/null

# The repo is mounted read-only: the rehearsal must never be able to "fix"
# the thing it is testing.
docker run --rm -i \
  -v "$REPO_ROOT:/kit:ro" \
  -e INSURWRECK_MARKETPLACE=/home/leader/kit \
  "$IMAGE" bash -s <<'REHEARSAL'
set -uo pipefail

PASS=0; FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# claude plugin marketplace add rejects a read-only source, so work from a copy.
cp -r /kit /home/leader/kit
chmod -R u+w /home/leader/kit

head "Before: what a bare machine actually has"
for t in node npm git claude ghostty; do
  command -v "$t" >/dev/null 2>&1 && echo "  present: $t" || echo "  missing: $t"
done

head "Running the one-paste command"
# --no-launch because there's no interactive session to hand over to in CI.
bash /home/leader/kit/desk/public/go.sh --no-ghostty --no-launch 2>&1 \
  | sed 's/^/  | /' || true

head "After: did it work?"
export PATH="$HOME/.local/bin:$PATH"

command -v claude >/dev/null 2>&1 \
  && ok "claude is installed ($(claude --version 2>/dev/null | head -1))" \
  || bad "claude is NOT on PATH"

[ -x "$HOME/.local/bin/claude" ] \
  && ok "binary at ~/.local/bin/claude" \
  || bad "binary missing from ~/.local/bin"

# The failure this whole step exists to prevent: install succeeds, PATH doesn't,
# participant sees command-not-found. Check a FRESH login shell, not this one.
if bash -lc 'command -v claude >/dev/null 2>&1'; then
  ok "claude resolves in a fresh login shell (PATH repair held)"
else
  bad "PATH repair did NOT survive a new shell — this is the morning-killer"
fi

grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null \
  && ok "PATH line written to .bashrc" \
  || bad "no PATH line in .bashrc"

[ -d "$HOME/insurwreck" ] \
  && ok "project folder created" \
  || bad "project folder missing"

grep -q '.env' "$HOME/insurwreck/.gitignore" 2>/dev/null \
  && ok "gitignore protects secrets from the first commit" \
  || bad "gitignore missing or incomplete"

head "Plugin"
if claude plugin marketplace list 2>/dev/null | grep -qi insurwreck; then
  ok "marketplace registered"
else
  bad "marketplace not registered"
fi

if claude plugin list 2>/dev/null | grep -qi insurwreck; then
  ok "plugin installed"
else
  bad "plugin not installed"
fi

# bin/ lands on PATH only inside a Claude session, so check the files instead.
for exe in iw-deploy iw-doctor; do
  [ -x "/home/leader/kit/plugin/bin/$exe" ] \
    && ok "$exe is executable" \
    || bad "$exe missing or not executable"
done

head "Re-run safety"
# A participant who pastes twice must not end up in a worse state.
bash /home/leader/kit/desk/public/go.sh --no-ghostty --no-launch >/tmp/second.log 2>&1
if [ "$(grep -c 'already' /tmp/second.log)" -ge 3 ]; then
  ok "second run is idempotent (skips what's done)"
else
  bad "second run did not skip completed steps"
  sed 's/^/    /' /tmp/second.log | tail -20
fi

if [ "$(grep -c '.local/bin' "$HOME/.bashrc")" -le 1 ]; then
  ok "PATH line not duplicated on re-run"
else
  bad "PATH line written twice — .bashrc is accumulating junk"
fi

printf '\n\033[1m%d passed, %d failed\033[0m\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
REHEARSAL

STATUS=$?

if [ "$SHELL_AFTER" = "1" ]; then
  echo "Opening a shell in the rehearsal box…"
  docker run --rm -it -v "$REPO_ROOT:/kit:ro" \
    -e INSURWRECK_MARKETPLACE=/home/leader/kit "$IMAGE" bash -l
fi

exit "$STATUS"
