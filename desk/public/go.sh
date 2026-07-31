#!/usr/bin/env bash
#
# Insurwreck 4.0 — one-paste setup.
#
#   curl -fsSL https://insurwreck-desk.preview.plumhq.com/go | bash
#
# Installs Ghostty, installs Claude Code, repairs PATH, installs Node 22+ and the
# Salesforce CLI the bundled MCP servers need, installs the insurwreck plugin,
# scaffolds a project folder, and launches you into it.
#
# Supports macOS, Linux, and Windows via WSL2. Native Windows shells (Git Bash,
# MSYS, Cygwin) are rejected with instructions, because WSL2 is the only path
# that works. Nothing here requires root.
#
# Safe to re-run. Every step checks before it acts, so a half-finished run
# just picks up where it stopped.

set -euo pipefail

# Overridable so the container rehearsal can point at a local checkout while
# the repo is still private.
KIT_REPO="${INSURWRECK_MARKETPLACE:-PlumHQ/insurwreck-kit}"
PROJECT_DIR="${INSURWRECK_DIR:-$HOME/insurwreck}"
# Last version verified reachable; only used if the download page can't be read.
GHOSTTY_DMG_FALLBACK="https://release.files.ghostty.org/1.3.1/Ghostty.dmg"
GHOSTTY_CONFIG_MAC="$HOME/Library/Application Support/com.mitchellh.ghostty/config"
GHOSTTY_CONFIG_XDG="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty/config"
# Highest floor among the bundled MCP servers (@kula-ai/mcp-server needs 22).
MIN_NODE=22

WITH_GHOSTTY=1
LAUNCH=1
for arg in "$@"; do
  case "$arg" in
    --no-ghostty) WITH_GHOSTTY=0 ;;
    --no-launch)  LAUNCH=0 ;;
    --help|-h)
      echo "usage: go.sh [--no-ghostty] [--no-launch]"
      exit 0 ;;
  esac
done

# ---------------------------------------------------------------- output ----

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
  GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; CYN=$'\033[36m'
else
  B=""; DIM=""; R=""; GRN=""; YLW=""; RED=""; CYN=""
fi

STEP=0
step()  { STEP=$((STEP+1)); printf "\n${B}${CYN}[%d/%d]${R} ${B}%s${R}\n" "$STEP" "$TOTAL_STEPS" "$1"; }
ok()    { printf "      ${GRN}✓${R} %s\n" "$1"; }
skip()  { printf "      ${DIM}·${R} ${DIM}%s${R}\n" "$1"; }
warn()  { printf "      ${YLW}!${R} %s\n" "$1"; }
info()  { printf "      %s\n" "$1"; }
die()   { printf "\n${RED}${B}✗ %s${R}\n\n" "$1" >&2; exit 1; }
have()  { command -v "$1" >/dev/null 2>&1; }

# -------------------------------------------------------------- platform ----

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)
    PLATFORM="linux"
    if grep -qi microsoft /proc/version 2>/dev/null; then PLATFORM="wsl"; fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    die "Windows shells (Git Bash / MSYS) aren't supported.
  Install WSL2 first — open PowerShell as Administrator and run:

      wsl --install

  Reboot, open the Ubuntu app, and paste this same command there."
    ;;
  *) die "Unsupported system: $OS" ;;
esac

# Ghostty ships macOS and Linux builds only. On WSL it needs an X/Wayland
# server, which we can't assume, so we skip it and stay in the user's terminal.
if [ "$PLATFORM" = "wsl" ] && [ "$WITH_GHOSTTY" = "1" ]; then
  WITH_GHOSTTY=0
  GHOSTTY_SKIP_REASON="running under WSL — using your existing terminal"
fi

TOTAL_STEPS=7
[ "$WITH_GHOSTTY" = "1" ] && TOTAL_STEPS=8

# ----------------------------------------------------------------- banner ----

cat <<'BANNER'

  ██╗███╗   ██╗███████╗██╗   ██╗██████╗ ██╗    ██╗██████╗ ███████╗ ██████╗██╗  ██╗
  ██║████╗  ██║██╔════╝██║   ██║██╔══██╗██║    ██║██╔══██╗██╔════╝██╔════╝██║ ██╔╝
  ██║██╔██╗ ██║███████╗██║   ██║██████╔╝██║ █╗ ██║██████╔╝█████╗  ██║     █████╔╝
  ██║██║╚██╗██║╚════██║██║   ██║██╔══██╗██║███╗██║██╔══██╗██╔══╝  ██║     ██╔═██╗
  ██║██║ ╚████║███████║╚██████╔╝██║  ██║╚███╔███╔╝██║  ██║███████╗╚██████╗██║  ██╗
  ╚═╝╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝

  4.0 · Leadership Hackathon · Bring one real problem. Leave with a prototype.

BANNER
printf "  ${DIM}%s · %s · setting up %d things${R}\n" "$PLATFORM" "$ARCH" "$TOTAL_STEPS"

# ------------------------------------------------------------ 1 preflight ----

step "Checking your machine"

have curl || die "curl is missing. Install it and re-run."

if [ "$PLATFORM" = "macos" ]; then
  MACOS_VER="$(sw_vers -productVersion 2>/dev/null || echo 0)"
  MACOS_MAJOR="${MACOS_VER%%.*}"
  if [ "$MACOS_MAJOR" -lt 13 ] 2>/dev/null; then
    die "Claude Code needs macOS 13 (Ventura) or newer. You're on $MACOS_VER."
  fi
  ok "macOS $MACOS_VER"
else
  ok "$(uname -sr)"
fi

if curl -fsS --max-time 10 -o /dev/null https://claude.ai/install.sh 2>/dev/null; then
  ok "network reaches claude.ai"
else
  die "Can't reach claude.ai — check your wifi or VPN, then re-run.
  If you're on a corporate network, try switching to a phone hotspot."
fi

# -------------------------------------------------------------- 2 ghostty ----

install_ghostty_macos() {
  if [ -d "/Applications/Ghostty.app" ]; then
    skip "Ghostty already in /Applications"
    return 0
  fi

  # Ghostty publishes no GitHub release assets and has no /latest/ alias, so
  # the download page is the only source of the current dmg URL. Scrape it,
  # and fall back to the last version verified working.
  local url dmg mount
  url="$(curl -fsSL --max-time 20 https://ghostty.org/download 2>/dev/null \
    | grep -oE 'https://release\.files\.ghostty\.org/[^"'"'"' ]+\.dmg' \
    | head -1 || true)"
  [ -n "$url" ] || url="$GHOSTTY_DMG_FALLBACK"

  dmg="$(mktemp -t ghostty).dmg"
  info "downloading Ghostty…"
  if ! curl -fsSL --max-time 300 -o "$dmg" "$url"; then
    warn "Ghostty download failed — skipping, everything else still works"
    rm -f "$dmg"
    return 0
  fi

  mount="$(mktemp -d)"
  if hdiutil attach -nobrowse -quiet -mountpoint "$mount" "$dmg" 2>/dev/null; then
    if cp -R "$mount/Ghostty.app" /Applications/ 2>/dev/null; then
      # Clear the download quarantine flag so Gatekeeper doesn't block first launch.
      xattr -dr com.apple.quarantine /Applications/Ghostty.app 2>/dev/null || true
      ok "Ghostty installed to /Applications"
    else
      warn "couldn't copy Ghostty into /Applications (permissions?) — skipping"
    fi
    hdiutil detach -quiet "$mount" 2>/dev/null || true
  else
    warn "couldn't open the Ghostty disk image — skipping"
  fi
  rm -rf "$dmg" "$mount"
}

install_ghostty_linux() {
  if have ghostty; then skip "Ghostty already installed"; return 0; fi

  # Every path below needs root, and the output is redirected to a log - so a
  # sudo password prompt would be invisible and the script would look frozen.
  # Check for passwordless sudo up front and bail out loudly instead.
  if ! sudo -n true 2>/dev/null; then
    skip "Ghostty needs sudo - install it later from https://ghostty.org/download"
    return 0
  fi

  local distro=""
  [ -r /etc/os-release ] && distro="$(. /etc/os-release && echo "${ID:-}")"

  local log
  log="$(mktemp)"

  case "$distro" in
    ubuntu|pop|tuxedo|neon|elementary|linuxmint|debian)
      # The .deb path Ghostty's own install docs point Ubuntu users at. It
      # pulls GTK4/libadwaita, so the package lists must be current first —
      # without this the dependency resolution fails on a fresh image.
      info "installing Ghostty (.deb)…"
      sudo apt-get update -qq >>"$log" 2>&1 || true
      if /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/mkasberg/ghostty-ubuntu/HEAD/install.sh)" >>"$log" 2>&1; then
        ok "Ghostty installed"; rm -f "$log"; return 0
      fi
      # Say what actually broke rather than blaming the distro.
      warn "Ghostty install failed - last lines:"
      tail -4 "$log" | sed 's/^/        /'
      rm -f "$log"
      info "everything else works; install Ghostty later from https://ghostty.org/download"
      return 0
      ;;
    arch|endeavouros|manjaro)
      if have pacman && sudo pacman -S --noconfirm ghostty >/dev/null 2>&1; then
        ok "Ghostty installed"; return 0
      fi
      ;;
    fedora|rhel)
      if have dnf && sudo dnf install -y ghostty >/dev/null 2>&1; then
        ok "Ghostty installed"; return 0
      fi
      ;;
  esac

  if have snap && sudo snap install ghostty --classic >/dev/null 2>&1; then
    ok "Ghostty installed"; return 0
  fi
  if have flatpak && flatpak install -y flathub com.mitchellh.ghostty >/dev/null 2>&1; then
    ok "Ghostty installed"; return 0
  fi

  warn "no Ghostty package for this distro (${distro:-unknown}) — skipping"
  info "everything else works; see https://ghostty.org/docs/install/binary"
}

write_ghostty_config() {
  local target
  if [ "$PLATFORM" = "macos" ]; then target="$GHOSTTY_CONFIG_MAC"; else target="$GHOSTTY_CONFIG_XDG"; fi
  mkdir -p "$(dirname "$target")"

  if [ -f "$target" ] && grep -q "insurwreck" "$target" 2>/dev/null; then
    skip "Ghostty config already set"
    return 0
  fi

  # Append rather than overwrite — never clobber someone's existing config.
  cat >> "$target" <<'CONF'

# --- insurwreck 4.0 -----------------------------------------------------
theme = dark
font-size = 14
window-padding-x = 12
window-padding-y = 10
cursor-style = block
macos-option-as-alt = true
# ------------------------------------------------------------------------
CONF
  ok "Ghostty configured"
}

if [ "$WITH_GHOSTTY" = "1" ]; then
  step "Installing Ghostty"
  case "$PLATFORM" in
    macos) install_ghostty_macos ;;
    linux) install_ghostty_linux ;;
  esac
  write_ghostty_config
elif [ -n "${GHOSTTY_SKIP_REASON:-}" ]; then
  step "Terminal"
  skip "$GHOSTTY_SKIP_REASON"
fi

# --------------------------------------------------------- 3 claude code ----

step "Installing Claude Code"

if have claude; then
  ok "already installed ($(claude --version 2>/dev/null | head -1))"
else
  info "downloading…"
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 \
    || die "Claude Code install failed. Try again, or see https://code.claude.com/docs/en/setup"
  ok "installed"
fi

# ------------------------------------------------------------- 4 the PATH ----
# The installer drops the binary at ~/.local/bin/claude. If that directory
# isn't on PATH, `claude` reports command-not-found even though the install
# worked — the single most common way this goes wrong.

step "Making the 'claude' command available"

LOCAL_BIN="$HOME/.local/bin"
# Ask BEFORE we export, or the answer is always yes and the "already on your
# PATH" line below becomes a lie that hides the one failure this step exists to
# catch: a shell that was started before the rc file was edited.
have claude && CLAUDE_ALREADY_ON_PATH=1 || CLAUDE_ALREADY_ON_PATH=0
export PATH="$LOCAL_BIN:$PATH"

path_line='export PATH="$HOME/.local/bin:$PATH"'
added_to=""
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  # Only touch a file that exists, plus the rc for the shell you actually use.
  case "$rc" in
    "$HOME/.zshrc")        [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = "zsh" ]  || continue ;;
    "$HOME/.bashrc"|"$HOME/.bash_profile")
                           [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = "bash" ] || continue ;;
    *)                     [ -f "$rc" ] || continue ;;
  esac
  touch "$rc"
  if ! grep -qF '.local/bin' "$rc" 2>/dev/null; then
    printf '\n# insurwreck 4.0 — Claude Code\n%s\n' "$path_line" >> "$rc"
    added_to="$added_to $(basename "$rc")"
  fi
done

if have claude; then
  if [ "$CLAUDE_ALREADY_ON_PATH" = "1" ]; then
    ok "already on your PATH"
  elif [ -n "$added_to" ]; then
    ok "added to PATH in:$added_to — new terminal windows will find it"
  else
    # An rc file already mentions .local/bin, yet a fresh shell still didn't
    # have it: the line is commented out, conditional, or overwritten later.
    # Say so rather than claiming success - the handover below still works,
    # but every new window they open will not.
    warn "your shell config mentions .local/bin but didn't apply it"
    info "if 'claude' is missing in a new window, add this to ~/.zshrc: $path_line"
  fi
else
  die "Claude Code installed but the 'claude' command still isn't found.
  Expected it at $LOCAL_BIN/claude — check that the file exists."
fi

# ------------------------------------------------------ 5 node + mcp deps ----
# The plugin ships two MCP servers that run as `npx` commands - salesforce and
# kula - so node has to exist before Claude Code first launches them. Two
# failure modes this step exists to prevent, both found the same way the git and
# Ghostty ones were:
#
#   1. No node at all. The servers just fail to start and the participant sees
#      two dead entries with no explanation.
#   2. Node present but a cold npx cache. @salesforce/mcp is a large download;
#      fetching it inside the MCP startup window can exceed it, so the server
#      reports failed on first launch and works on the second. Prewarming makes
#      the first launch the fast one.
#
# Nothing here is fatal. Claude Code, the desk, and the Plum data server all
# work without Salesforce or Kula, so a failure warns and moves on.

step "Setting up the Salesforce and Kula tools"

# Official prebuilt tarball into ~/.local — same place claude lives, already on
# PATH from step 4, and needs no sudo or package manager.
install_node_tarball() {
  local ver="v22.14.0" plat arch url tmp
  case "$PLATFORM" in
    macos) plat="darwin" ;;
    linux|wsl) plat="linux" ;;
    *) return 1 ;;
  esac
  case "$ARCH" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) return 1 ;;
  esac
  url="https://nodejs.org/dist/$ver/node-$ver-$plat-$arch.tar.gz"
  tmp="$(mktemp -d)"
  curl -fsSL --max-time 180 "$url" -o "$tmp/node.tar.gz" || { rm -rf "$tmp"; return 1; }
  mkdir -p "$HOME/.local"
  tar -xzf "$tmp/node.tar.gz" -C "$tmp" || { rm -rf "$tmp"; return 1; }
  cp -R "$tmp/node-$ver-$plat-$arch/." "$HOME/.local/" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  export PATH="$LOCAL_BIN:$PATH"
  have node
}

# @kula-ai/mcp-server declares node >=22 and @salesforce/mcp declares >=20, so
# an older node leaves those two servers dead with no obvious cause. Ubuntu
# 24.04 - which is what WSL2 installs by default - ships node 18.19.1 from apt,
# already end-of-life upstream. So the version is checked, not just the presence,
# and the official tarball is the only install path: it is current, needs no
# sudo, and behaves identically on macOS and Linux.
node_major() {
  local v
  v="$(node --version 2>/dev/null)" || return 1
  v="${v#v}"; printf '%s' "${v%%.*}"
}

if have node && have npx && [ "$(node_major || echo 0)" -ge "$MIN_NODE" ] 2>/dev/null; then
  ok "node $(node --version 2>/dev/null)"
else
  if have node; then
    info "node $(node --version 2>/dev/null) is too old for the Salesforce and Kula servers; installing $MIN_NODE+…"
  else
    info "installing node…"
  fi
  if install_node_tarball; then
    ok "node $(node --version 2>/dev/null)"
  else
    warn "couldn't install node automatically"
    info "install Node $MIN_NODE or newer from https://nodejs.org, then run: iw-doctor"
  fi
fi

if have npm; then
  # `sf` is how the Salesforce MCP server gets a session: it reads orgs the CLI
  # already authorised, and never takes a password itself.
  if have sf; then
    skip "salesforce cli already installed"
  elif npm i -g @salesforce/cli >/dev/null 2>&1; then
    ok "salesforce cli installed"
  else
    warn "salesforce cli didn't install — run: npm i -g @salesforce/cli"
  fi

  # Populate the npx cache so the first MCP launch doesn't race its own
  # download. --version exits immediately once the package is fetched.
  for pkg in "@salesforce/mcp" "@kula-ai/mcp-server" "zd-mcp-server"; do
    if npx -y "$pkg" --version >/dev/null 2>&1; then
      ok "cached $pkg"
    else
      # A non-zero exit here is usually the package rejecting --version, not a
      # download failure, so this is informational only.
      skip "$pkg will download on first use"
    fi
  done
else
  warn "no npm, so the salesforce and kula servers will not start"
  info "install node from https://nodejs.org, then run: iw-doctor"
fi

# ---------------------------------------------------------- 6 the plugin ----
# `claude plugin ...` is the non-interactive path. Doing it here means the
# participant never types /plugin marketplace add themselves.

step "Installing the Insurwreck plugin"

plugin_log="$(mktemp)"

# `claude plugin marketplace add owner/repo` shells out to `git clone`. On a
# fresh Mac git is an Xcode Command Line Tools shim that opens a GUI installer
# rather than working, so we can't assume it. Prefer a zip download, which needs
# nothing but curl and an unzipper, and fall back to git only if that fails.
install_from_tarball() {
  local dir extracted
  dir="$HOME/.insurwreck/kit"
  rm -rf "$dir"; mkdir -p "$dir"

  # tar is native on macOS and every mainstream Linux; unzip and python3 are not
  # guaranteed on either, and git is exactly what we're avoiding.
  curl -fsSL --max-time 120 "https://codeload.github.com/${KIT_REPO}/tar.gz/refs/heads/main" \
    2>>"$plugin_log" | tar -xz -C "$dir" 2>>"$plugin_log" || return 1

  # The archive extracts to <repo>-main/; locate whatever holds the manifest.
  extracted="$(find "$dir" -maxdepth 3 -path '*/.claude-plugin/marketplace.json' 2>/dev/null | head -1)"
  [ -n "$extracted" ] || return 1
  extracted="$(dirname "$(dirname "$extracted")")"

  claude plugin marketplace add "$extracted" >>"$plugin_log" 2>&1 || true
  return 0
}

case "$KIT_REPO" in
  /*|./*|~*)
    # A local checkout - organizers testing, and the container rehearsal.
    claude plugin marketplace add "$KIT_REPO" >>"$plugin_log" 2>&1 \
      || skip "marketplace already registered"
    ;;
  *)
    if ! install_from_tarball; then
      info "tarball install unavailable, trying git…"
      claude plugin marketplace add "$KIT_REPO" >>"$plugin_log" 2>&1 \
        || skip "marketplace already registered"
    fi
    ;;
esac

claude plugin install insurwreck@insurwreck-kit --scope user >>"$plugin_log" 2>&1 \
  || skip "plugin already present"

# Don't trust the exit codes above - "already installed" and "couldn't reach the
# repo" are indistinguishable there. Ask what's actually installed instead,
# because a silent miss here means every command in this kit is absent.
if claude plugin list 2>/dev/null | grep -q "insurwreck@insurwreck-kit"; then
  ok "plugin installed"
else
  printf "\n${RED}${B}✗ The Insurwreck plugin did not install.${R}\n\n" >&2
  sed 's/^/    /' "$plugin_log" | tail -6 >&2
  cat >&2 <<EOF

  Everything else is set up, so this is recoverable. Show an organizer this
  screen - the usual cause is that the kit repository isn't public yet.

  Once they confirm it is, run:

      claude plugin marketplace add $KIT_REPO
      claude plugin install insurwreck@insurwreck-kit --scope user

EOF
  rm -f "$plugin_log"
  exit 1
fi
rm -f "$plugin_log"

# Claude Code puts the plugin's bin/ on PATH for its own tool calls, but only
# inside a running session. Out here - and in the participant's own terminal,
# where the README tells them to type `iw-doctor` - nothing does. Link the
# scripts into ~/.local/bin, which step 4 already put on PATH and wrote into
# their shell rc, so `iw-*` works everywhere rather than only inside the agent.
link_kit_bin() {
  local bin_dir
  for bin_dir in \
    "$HOME"/.insurwreck/kit/*/plugin/bin \
    "$HOME"/.claude/plugins/marketplaces/*/plugin/bin \
    "$HOME"/.claude/plugins/cache/*/plugin/bin
  do
    [ -d "$bin_dir" ] || continue
    [ -x "$bin_dir/iw-intro" ] || continue
    mkdir -p "$LOCAL_BIN"
    for script in "$bin_dir"/iw-*; do
      [ -x "$script" ] || continue
      ln -sf "$script" "$LOCAL_BIN/$(basename "$script")"
    done
    return 0
  done
  return 1
}

if link_kit_bin; then
  ok "iw-* commands available in your terminal"
else
  # Not fatal: everything still works inside Claude Code, which finds them itself.
  skip "iw-* commands are available inside Claude Code only"
fi

# -------------------------------------------------------- 7 project folder ----

step "Creating your project folder"

if [ -d "$PROJECT_DIR" ]; then
  skip "$PROJECT_DIR already exists"
else
  mkdir -p "$PROJECT_DIR"
  ok "created $PROJECT_DIR"
fi

# Keep secrets out of git from the very first commit, before anyone makes one.
if [ ! -f "$PROJECT_DIR/.gitignore" ]; then
  cat > "$PROJECT_DIR/.gitignore" <<'GI'
.env*
.insurwreck*
node_modules/
.vercel
.DS_Store
GI
  ok "added a .gitignore that keeps your keys out of git"
fi

# A project-scoped CLAUDE.md, written before Claude ever starts so the very
# first session has it. Without this the default behaviour is to read the idea
# brief and build the whole thing in one turn - which produces something that
# demoes but that the participant did not shape and cannot explain. The point of
# the day is their thinking, not the model's throughput.
if [ ! -f "$PROJECT_DIR/CLAUDE.md" ]; then
  cat > "$PROJECT_DIR/CLAUDE.md" <<'CM'
# How to work on this project

This is a one-day hackathon build. The person you are working with is a Plum
leader who brought a real problem. They are not a developer, and the value of
the day is their judgement about the problem - not how fast you can produce code.

## Do not build the whole thing in one go

Never scaffold an entire application from the idea brief in a single turn, even
when the brief seems clear enough to. A system produced that way is one the
participant did not shape, cannot explain on stage, and cannot steer afterwards.

Build the smallest useful slice, show it, and let them react. Then the next
slice. Their reaction to something real is better information than any answer
they can give in the abstract.

## Brainstorm first, and only about the product

Before writing application code, understand what they actually want. Ask about
the **problem and the people**, never about the implementation:

Ask things like:
- Who has this problem, and what do they do about it today?
- What decision or action should this thing make easier?
- What would you look at first thing in the morning?
- What does "this worked" look like in one sentence?
- What is the smallest version that would still be useful to someone?

Never ask them things like:
- Which framework, database, or hosting should we use?
- Should this be server-rendered? REST or GraphQL? What schema?
- Which library should handle X?

Those are your decisions. They have a stack already provisioned - use it and do
not make them choose. If a technical choice genuinely changes what the product
can do, explain the consequence in product terms and recommend one option.

## Keep it short, then commit to building

This is a conversation, not an interview, and it must not become a loop.

1. Ask **3 to 5 questions in one message** - not one at a time.
2. At most **one** follow-up round, and only to resolve something that would
   change what you build first.
3. Then write `BRIEF.md` in this folder: the problem, who it is for, what the
   first slice does, and what is explicitly out of scope for today.
4. Then start building that first slice.

Once `BRIEF.md` exists, stop asking scoping questions and build. If they say
"just build it", "I don't know, you decide", or seem impatient: write `BRIEF.md`
from your best reading, say in one line what you assumed, and start. Never let
the brainstorm become the reason nothing shipped.

## While building

- Show working software early and often. A running page beats a plan.
- After each slice, say what it does and ask what is wrong with it - not whether
  to continue.
- When they change direction, update `BRIEF.md`. It is the shared memory of what
  this is, and what you both agreed to leave out.
CM
  ok "added CLAUDE.md so the build starts with a conversation, not a code dump"
fi

# ------------------------------------------------------------- 8 hand off ----

step "Ready"

cat <<EOF

  ${B}Everything is installed.${R}

  ${DIM}Your project folder:${R}  $PROJECT_DIR
  ${DIM}Next:${R}                 run ${B}/insurwreck:start${R} inside Claude Code

EOF

# --permission-mode auto so the day isn't spent approving prompts. Onboarding
# alone runs curl, writes files and installs CLIs; a leader who has never used a
# terminal reads each of those approvals as "is this safe?" and stalls. The
# guardrails that matter are hooks, not prompts - block-secrets and
# block-destructive still run on every Bash call, and they deny rather than ask.
CLAUDE_LAUNCH="claude --permission-mode auto"

if [ "$LAUNCH" = "0" ]; then
  info "Start it yourself with:  export PATH=\"\$HOME/.local/bin:\$PATH\" && cd $PROJECT_DIR && $CLAUDE_LAUNCH"
  exit 0
fi

if [ ! -t 0 ]; then
  # Piped from curl, so stdin isn't a terminal and we can't hand over an
  # interactive session. Tell them the one line to paste instead.
  # export PATH first, always. This line is pasted into the shell that ran the
  # curl - a shell started before step 4 edited its rc file, so it has never
  # heard of ~/.local/bin and reports "command not found: claude" on a install
  # that worked perfectly. Harmless when the PATH is already right.
  printf "  ${B}Paste this to begin:${R}\n\n      export PATH=\"\$HOME/.local/bin:\$PATH\" && cd %s && %s\n\n  ${DIM}Once Claude Code starts, type${R} ${B}/insurwreck:start${R}\n\n" "$PROJECT_DIR" "$CLAUDE_LAUNCH"
  exit 0
fi

cd "$PROJECT_DIR"
# A wordmark at the handover, in colour because this is a real terminal. Never
# let a cosmetic script block the handover.
if command -v iw-intro >/dev/null 2>&1; then
  iw-intro || true
fi

exec claude --permission-mode auto
