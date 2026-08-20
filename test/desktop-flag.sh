#!/usr/bin/env bash
#
# Check the --desktop path without installing anything.
#
# The real installer is exercised by test/dryrun.sh in Docker. This covers the
# three things --desktop changes, which a container run would not fail on:
# the flag itself, the plugin config written into the project folder, and the
# fact that the desktop handoff replaces the terminal one instead of both firing.

set -euo pipefail
GO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/desk/public/go.sh"
fail() { echo "FAIL: $1" >&2; exit 1; }

bash -n "$GO" || fail "go.sh does not parse"

bash "$GO" --help | grep -q -- '--desktop' || fail "--help does not mention --desktop"

# Flag parsing, in isolation: --desktop must imply no Ghostty and no launch.
eval "$(sed -n '/^WITH_GHOSTTY=1/,/^done$/p' "$GO" | sed 's/"\$@"/"--desktop"/')"
[ "$DESKTOP" = "1" ]      || fail "--desktop did not set DESKTOP"
[ "$WITH_GHOSTTY" = "0" ] || fail "--desktop left Ghostty on"
[ "$LAUNCH" = "0" ]       || fail "--desktop left the terminal handover on"

# The settings.json the folder gets must be valid JSON naming the marketplace
# and the plugin exactly as the marketplace manifest does - a typo here is
# invisible until a participant opens the folder and gets nothing offered.
KIT_REPO="PlumHQ/insurwreck-kit"
json="$(sed -n '/^  cat > "\$PROJECT_DIR\/.claude\/settings.json" <<SET$/,/^SET$/p' "$GO" \
        | sed '1d;$d' | KIT_REPO="$KIT_REPO" envsubst)"
[ -n "$json" ] || fail "could not find the settings.json heredoc"
printf '%s' "$json" | python3 -c '
import json,sys
d = json.load(sys.stdin)
assert "insurwreck-kit" in d["extraKnownMarketplaces"], "marketplace name must match marketplace.json"
assert d["extraKnownMarketplaces"]["insurwreck-kit"]["source"]["repo"] == "PlumHQ/insurwreck-kit"
assert d["enabledPlugins"] == ["insurwreck@insurwreck-kit"], d["enabledPlugins"]
' || fail "settings.json is not valid or names the plugin wrongly"

# Desktop mode must not install Claude Code or Ghostty - the participant is
# reading the instructions from inside Claude Code, and Ghostty needs a desktop
# session the app does not give it. This is the whole point of the flag.
grep -q 'if \[ "$DESKTOP" = "0" \]; then' "$GO" || fail "desktop mode still installs Claude Code"
grep -q '\[ "$DESKTOP" = "1" \] && TOTAL_STEPS=6' "$GO" || fail "step count not reduced for desktop"

# ...and it must not need a `claude` CLI at all: the app injects its own shim,
# so a missing one is normal, not fatal.
grep -q 'PLUGIN_VIA_UI=1' "$GO" || fail "no fallback when the claude CLI is absent"
grep -q 'elif \[ "$DESKTOP" = "1" \]; then' "$GO" \
  || fail "desktop mode still dies when the claude CLI is missing"
grep -c 'die "Claude Code installed but' "$GO" | grep -qx 1 \
  || fail "expected exactly one claude-missing die, guarded by the elif above"

# Exactly one handoff: the desktop block must exit before the terminal text.
grep -q 'if \[ "$DESKTOP" = "1" \]; then' "$GO" || fail "no desktop handoff branch"
awk '/if \[ "\$DESKTOP" = "1" \]; then/,/^fi$/' "$GO" | grep -q '  exit 0' \
  || fail "desktop handoff falls through into the terminal handoff"

# ----------------------------------------------------------------- windows ---
# go.ps1 is served through `irm | iex`, which parses the whole file before it
# runs a line, so a syntax slip kills the run outright. Reuse the real parser.
PS="$(dirname "${BASH_SOURCE[0]}")/parse-go-ps1.sh"
"$PS" | grep -q 'parses cleanly' || fail "go.ps1 does not parse (or pwsh is missing - install it)"

GOPS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/desk/public/go.ps1"

# `irm | iex` cannot pass arguments, so the switch has to be an env var.
grep -q 'INSURWRECK_DESKTOP' "$GOPS" || fail "go.ps1 has no desktop switch"
grep -q 'if ($Desktop) {' "$GOPS"    || fail "go.ps1 never branches on it"

# Same two guarantees as macOS: no Claude Code install, and no dependence on a
# CLI the app only injects into shells it opens itself.
awk '/Write-Step "Installing Claude Code"/,/^}$/' "$GOPS" | grep -q 'claude.ai/install.ps1' \
  || fail "go.ps1 claude-install block moved - re-check the desktop guard"
grep -q '\$PluginViaUi = \$true' "$GOPS" || fail "go.ps1 has no plugin fallback"

# The desktop handoff must exit, or the participant gets both sets of
# instructions and follows the terminal one.
awk '/^if \(\$Desktop\) \{$/,/^}$/' "$GOPS" | grep -q 'exit 0' \
  || fail "go.ps1 desktop handoff falls through into the terminal handoff"

# Both platforms must write the same marketplace name and plugin id, or one OS
# silently gets a folder that points nowhere.
psjson="$(sed -n '/^  @"$/,/^"@ | ForEach-Object { Write-Utf8NoBom -Path \$settings/p' "$GOPS" \
          | sed '1d;$d' | sed "s|\$KitRepo|$KIT_REPO|")"
[ -n "$psjson" ] || fail "could not find the settings.json here-string in go.ps1"
printf '%s' "$psjson" | python3 -c '
import json,sys
d = json.load(sys.stdin)
assert "insurwreck-kit" in d["extraKnownMarketplaces"]
assert d["extraKnownMarketplaces"]["insurwreck-kit"]["source"]["repo"] == "PlumHQ/insurwreck-kit"
assert d["enabledPlugins"] == ["insurwreck@insurwreck-kit"], d["enabledPlugins"]
' || fail "go.ps1 settings.json is invalid or disagrees with go.sh"

echo "ok - macOS and Windows: desktop switch, no reinstall, folder config, one handoff"
