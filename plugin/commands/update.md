---
description: Update the Insurwreck kit to the latest version
---

Pull the newest kit and report honestly whether it actually moved.

**Read this first, because the obvious commands are not enough.** The marketplace on a participant's machine is a *directory* source — `go.sh` created it by extracting a tarball to `~/.insurwreck/kit/`. It has no git remote. So `claude plugin marketplace update` only re-validates those files; it fetches nothing, and then `claude plugin update` reports "already at the latest version" while being one or more releases behind. Both commands succeed and nothing changes. Re-downloading the tarball is the update.

## Step 1 — Note the version installed now

```bash
claude plugin list 2>/dev/null | grep -A2 'insurwreck@insurwreck-kit'
```

Keep the version string. You need it in Step 4 to tell the participant whether anything actually changed.

## Step 2 — Re-fetch the kit

Only if the marketplace is a directory source. Check it:

```bash
node -e 'const m=require(process.env.HOME+"/.claude/plugins/known_marketplaces.json")["insurwreck-kit"];console.log(m?.source?.source||"absent",m?.installLocation||"")'
```

- Prints `directory <path>` → re-fetch with the block below.
- Prints `github …` → skip to Step 3; that source really does pull.
- Prints `absent` → the kit was never installed here. Tell them to re-run the setup command from the invite, and stop.

Re-fetch, mirroring what `go.sh` does so the layout matches exactly:

```bash
set -e
dir="$HOME/.insurwreck/kit"
tmp="$(mktemp -d)"
curl -fsSL --max-time 120 "https://codeload.github.com/PlumHQ/insurwreck-kit/tar.gz/refs/heads/main" | tar -xz -C "$tmp"
manifest="$(find "$tmp" -maxdepth 3 -path '*/.claude-plugin/marketplace.json' | head -1)"
[ -n "$manifest" ] || { echo "download looks wrong — no marketplace.json found"; exit 1; }
rm -rf "$dir" && mkdir -p "$dir"
mv "$(dirname "$(dirname "$manifest")")" "$dir/"
rm -rf "$tmp"
node -e 'console.log("fetched version:",require(process.env.HOME+"/.insurwreck/kit/insurwreck-kit-main/plugin/.claude-plugin/plugin.json").version)'
```

The download is extracted to a temp directory and only swapped in once its manifest is confirmed present — a failed or truncated download must never leave the participant with no kit at all.

If the `curl` fails (offline, VPN, GitHub down), say so plainly and stop. Their existing kit still works; a failed update is not an emergency.

## Step 3 — Re-register and update the plugin

```bash
claude plugin marketplace update insurwreck-kit
claude plugin update insurwreck@insurwreck-kit
```

## Step 4 — Report what actually happened

```bash
claude plugin list 2>/dev/null | grep -A2 'insurwreck@insurwreck-kit'
```

Compare against Step 1 and say which of these it was:

- **Version changed** — name both versions ("0.4.0 → 0.5.0") and tell them to restart Claude Code. New commands, changed commands, and new MCP servers all load at startup; without a restart they will look missing.
- **Version identical** — say they were already current. Do not imply an update happened.
- **Step 2 re-fetched a newer version but `claude plugin list` still shows the old one** — the CLI is holding a cached install. Tell them to run `/plugin marketplace update insurwreck-kit` then `/plugin install insurwreck@insurwreck-kit` as slash commands, and restart.

If the `claude plugin` CLI is missing or errors, the slash-command equivalents are `/plugin marketplace update insurwreck-kit` followed by `/plugin install insurwreck@insurwreck-kit` — but note that those have the same limitation as Step 3, so Step 2 still has to happen first.

Never claim the kit is up to date on the strength of a command exiting 0. Only a version comparison proves it.
