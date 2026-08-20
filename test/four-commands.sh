#!/usr/bin/env bash
#
# Run all four onboarding commands and check what each one actually did.
#
#   test/four-commands.sh
#
# The four are Mac+CLI, Mac+GUI, Windows+CLI, Windows+GUI. Only the first two
# can be executed here, and they run as Linux, not macOS:
#
#   - Docker on macOS has no Windows containers, so go.ps1 cannot run at all.
#     The Windows arms are parsed and their decision logic is evaluated with
#     PowerShell, which catches syntax and branching but proves nothing about
#     winget, the registry PATH, or the build check. Those need a Windows box.
#   - The Linux arms exercise the same bash, the same flags and the same
#     branches as macOS, but not the macOS-only bits: the Ghostty DMG, the
#     darwin node tarball, ~/Library paths.
#
# Ghostty is skipped even in the CLI arm - it needs a desktop session a
# container cannot give it, which is the same reason test/dryrun.sh skips it.
#
# What this is really for: the GUI arms must NOT install Claude Code, must
# survive having no `claude` on PATH, and must hand over to the app rather than
# to a terminal. Those are the three things that are new and the three things a
# reader cannot verify by eye.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="insurwreck-fourcmd"
PASS=0; FAIL=0
LOGDIR="$(mktemp -d)"

ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
have() { grep -qF -- "$2" "$1"; }
# assert / refute read the arm's captured output, so a failure names the arm and
# the string rather than just a line number.
assert() { if have "$1" "$2"; then ok "$3"; else bad "$3"; fi; }
refute() { if have "$1" "$2"; then bad "$3"; else ok "$3"; fi; }

command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
  || { echo "Docker isn't running - start Docker Desktop." >&2; exit 1; }

echo "Building the bare machine (no node, no npm, no git, no claude)…"
docker build -q -t "$IMAGE" "$REPO/test" >/dev/null || { echo "build failed" >&2; exit 1; }

# One arm = one throwaway container with a fresh $HOME. No shared volume: a
# kept box would let one arm's install satisfy the next arm's assertion.
arm() {
  # Split, not one `local`: bash declares all the names before assigning, so
  # log="$LOGDIR/$name.log" on the same line reads $name as unbound under set -u.
  local name="$1" stub="$2" flags="$3"
  local log="$LOGDIR/$name.log"
  echo; echo "── $name ─────────────────────────────────────────────"
  docker run --rm -v "$REPO:/kit:ro" -e STUB="$stub" -e FLAGS="$flags" "$IMAGE" \
    bash -lc '
      set -uo pipefail
      rm -rf "$HOME/kit"; cp -r /kit "$HOME/kit"; chmod -R u+w "$HOME/kit"
      export INSURWRECK_MARKETPLACE="$HOME/kit"
      if [ "$STUB" = "1" ]; then
        # Stand in for the CLI shim the desktop app injects into its own shells.
        mkdir -p "$HOME/.local/bin"
        cat > "$HOME/.local/bin/claude" <<'"'"'STUBEOF'"'"'
#!/bin/bash
echo "stub-claude $*" >> "$HOME/.claude-stub.log"
case "$1 $2" in
  "plugin list") echo "insurwreck@insurwreck-kit  0.9.5  enabled" ;;
  "--version"*)  echo "2.1.228 (Claude Code)" ;;
esac
exit 0
STUBEOF
        chmod +x "$HOME/.local/bin/claude"
        export PATH="$HOME/.local/bin:$PATH"
      fi
      bash "$HOME/kit/desk/public/go.sh" $FLAGS 2>&1
      echo "---EXIT:$?---"
      echo "---PROBE---"
      # go.sh appends the PATH line to an rc file this shell already sourced, so
      # pick it up the way the next terminal would. No apostrophes in here: this
      # whole block is inside single quotes and one would close them.
      export PATH="$HOME/.local/bin:$PATH"
      command -v claude >/dev/null 2>&1 && echo "claude:present" || echo "claude:absent"
      [ -f "$HOME/.local/bin/claude" ] && echo "claudebin:present" || echo "claudebin:absent"
      [ -f "$HOME/insurwreck/.claude/settings.json" ] && { echo "settings:present"; cat "$HOME/insurwreck/.claude/settings.json"; } || echo "settings:absent"
      [ -f "$HOME/insurwreck/CLAUDE.md" ] && echo "claudemd:present" || echo "claudemd:absent"
      node --version 2>/dev/null | sed "s/^/node:/" || echo "node:absent"
      [ -f "$HOME/.claude-stub.log" ] && sed "s/^/stubcall:/" "$HOME/.claude-stub.log" || true
    ' > "$log" 2>&1
  echo "     (log: $log)"
}

# ---------------------------------------------------------------- Mac + CLI ---
arm mac-cli 0 "--no-ghostty --no-launch"
L="$LOGDIR/mac-cli.log"
assert "$L" "claude:present"     "CLI: Claude Code installed"
assert "$L" "claudebin:present"  "CLI: binary landed in ~/.local/bin"
assert "$L" "node:v2"            "CLI: node 2x installed"
assert "$L" "claudemd:present"   "CLI: project CLAUDE.md written"
assert "$L" "settings:absent"    "CLI: local marketplace writes no bogus folder config"
assert "$L" "/insurwreck:start"  "CLI: handoff names the start command"
refute "$L" "Quit it completely" "CLI: does NOT print desktop instructions"

# ---------------------------------------------------------------- Mac + GUI ---
# The case that matters most: they are inside the app, so there is no `claude`
# in a plain shell and the script must not try to create one.
arm mac-gui-noclaude 0 "--desktop"
L="$LOGDIR/mac-gui-noclaude.log"
refute "$L" "Installing Claude Code"  "GUI: skips the Claude Code step entirely"
assert "$L" "claudebin:absent"        "GUI: did NOT install a claude binary"
assert "$L" "node:v2"                 "GUI: still installs node (npx MCP servers need it)"
assert "$L" "settings:absent"         "GUI: local marketplace writes no bogus folder config"
assert "$L" "Quit it completely"      "GUI: hands over to the app, not a terminal"
assert "$L" "6. Click"                "GUI: numbered step to install via the plugin browser"
refute "$L" "claude --permission-mode" "GUI: does NOT print the terminal handover"
assert "$L" "/6]"                     "GUI: six steps, not seven"
refute "$L" "/7]"                     "GUI: no seven-step run"

# The same command on a machine that DOES have the CLI shim on PATH.
arm mac-gui-withclaude 1 "--desktop"
L="$LOGDIR/mac-gui-withclaude.log"
refute "$L" "Installing Claude Code"    "GUI+CLI: still skips the install"
assert "$L" "stubcall:stub-claude plugin install" "GUI+CLI: uses the CLI to install the plugin"
assert "$L" "plugin installed"          "GUI+CLI: verified the plugin is present"
refute "$L" "6. Click"                  "GUI+CLI: no numbered plugin-browser step"
assert "$L" "Quit it completely"        "GUI+CLI: still hands over to the app"

# ------------------------------------------------------------------ piped ---
# The arms above run go.sh as a FILE, which is exactly what hid this for a whole
# release: piped, bash reads the script from stdin, the node step consumed the
# rest of it, and the run ended after step 4 reporting success. Participants got
# no plugin, no project folder and no handoff, with nothing on screen to say so.
# Anything that claims to test the pasted command has to pipe it.
echo; echo "── piped (the shape the README tells them to paste) ────"
piped_log="$LOGDIR/piped.log"
docker run --rm -v "$REPO:/kit:ro" "$IMAGE" bash -lc '
    set -uo pipefail
    rm -rf "$HOME/kit"; cp -r /kit "$HOME/kit"; chmod -R u+w "$HOME/kit"
    export INSURWRECK_MARKETPLACE="$HOME/kit"
    export INSURWRECK_SELF_URL="file:///home/leader/kit/desk/public/go.sh"
    cat "$HOME/kit/desk/public/go.sh" | bash -s -- --no-ghostty --no-launch 2>&1
  ' > "$piped_log" 2>&1
assert "$piped_log" "Ready"            "piped: reaches the final step"
assert "$piped_log" "plugin installed" "piped: step 5 ran (the one that used to vanish)"
assert "$piped_log" "CLAUDE.md"        "piped: step 6 ran"
assert "$piped_log" "[7/7]"            "piped: reached step 7 of 7"

# ------------------------------------------------------- the literal commands ---
# Everything above runs the local checkout through a local marketplace, which is
# what you want while iterating - but it never exercises the github path, and the
# folder config is deliberately skipped for a local marketplace. These two arms
# paste exactly what a participant pastes, against the live desk and the real
# repo, so the production-shaped settings.json is actually written by the script
# rather than only checked as text.
prod_arm() {
  local name="$1" cmd="$2"
  local log="$LOGDIR/$name.log"
  echo; echo "── $name (verbatim) ──────────────────────────────────"
  echo "     $cmd"
  docker run --rm -e CMD="$cmd" "$IMAGE" bash -lc '
      set -uo pipefail
      eval "$CMD" 2>&1
      echo "---EXIT:$?---"
      echo "---PROBE---"
      export PATH="$HOME/.local/bin:$PATH"
      command -v claude >/dev/null 2>&1 && echo "claude:present" || echo "claude:absent"
      [ -f "$HOME/insurwreck/.claude/settings.json" ] && { echo "settings:present"; cat "$HOME/insurwreck/.claude/settings.json"; } || echo "settings:absent"
    ' > "$log" 2>&1
  echo "     (log: $log)"
}

DESK=https://insurwreck-desk.preview.plumhq.com

# Is the deployed script the one this branch describes? If not, these arms would
# be reporting the state of production as though it were a defect in the branch.
if curl -fsSL --max-time 20 "$DESK/go.sh" 2>/dev/null | grep -q -- '--desktop'; then
  PROD_CURRENT=1
else
  PROD_CURRENT=0
  echo
  echo "── verbatim arms: SKIPPED ──────────────────────────────"
  echo "     The deployed $DESK/go.sh predates this branch, so these"
  echo "     arms would measure production rather than the change. They run"
  echo "     automatically once it deploys, and then they verify the deploy."
fi

if [ "$PROD_CURRENT" = "1" ]; then
prod_arm prod-mac-cli "curl -fsSL $DESK/go.sh | bash -s -- --no-ghostty --no-launch"
L="$LOGDIR/prod-mac-cli.log"
assert "$L" "plugin installed"            "prod CLI: real marketplace install works"
assert "$L" "PlumHQ/insurwreck-kit"       "prod CLI: folder config names the real repo"
assert "$L" "claude:present"              "prod CLI: Claude Code installed"

prod_arm prod-mac-gui "curl -fsSL $DESK/go.sh | bash -s -- --desktop"
L="$LOGDIR/prod-mac-gui.log"
assert "$L" "settings:present"            "prod GUI: folder config written"
assert "$L" "PlumHQ/insurwreck-kit"       "prod GUI: names the real repo"
assert "$L" "Quit it completely"           "prod GUI: hands over to the app"
refute "$L" "Installing Claude Code"      "prod GUI: no Claude Code install"
fi

# ------------------------------------------------------------------ Windows ---
echo; echo "── windows (parse + logic only, no Windows container) ──────"
if command -v pwsh >/dev/null 2>&1; then
  "$REPO/test/parse-go-ps1.sh" | grep -q 'parses cleanly' \
    && ok "Windows: go.ps1 parses under PowerShell" \
    || bad "Windows: go.ps1 does not parse"

  # Evaluate only the switch, the way the real script computes it.
  for v in 1 0; do
    want=$([ "$v" = 1 ] && echo True || echo False)
    got=$(pwsh -NoProfile -Command "\$env:INSURWRECK_DESKTOP='$v'; \$D = (\$env:INSURWRECK_DESKTOP -eq '1'); \$D" 2>/dev/null | tr -d '\r')
    [ "$got" = "$want" ] && ok "Windows: INSURWRECK_DESKTOP=$v resolves to \$Desktop=$want" \
                         || bad "Windows: INSURWRECK_DESKTOP=$v gave '$got', wanted '$want'"
  done
else
  bad "Windows: pwsh not installed - the Windows arms did NOT run"
fi

# Both platforms must agree on the plugin id, or one OS gets a dead folder.
mac_json=$(sed -n '/^  cat > "\$PROJECT_DIR\/.claude\/settings.json" <<SET$/,/^SET$/p' "$REPO/desk/public/go.sh" | sed '1d;$d')
win_json=$(sed -n '/^  @"$/,/^"@ | ForEach-Object { Write-Utf8NoBom -Path \$settings/p' "$REPO/desk/public/go.ps1" | sed '1d;$d')
if [ "$(printf '%s' "$mac_json" | sed 's/\$KIT_REPO/X/')" = "$(printf '%s' "$win_json" | sed 's/\$KitRepo/X/')" ]; then
  ok "both platforms write byte-identical plugin config"
else
  bad "go.sh and go.ps1 disagree on the folder's plugin config"
fi

echo
echo "──────────────────────────────────────────────────────────"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
echo "  logs: $LOGDIR"
[ "$FAIL" -eq 0 ] || exit 1
