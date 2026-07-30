#!/usr/bin/env bash
# Parse go.ps1 with PowerShell's own parser before anyone runs it.
#
#   test/parse-go-ps1.sh
#
# go.ps1 is served to participants and executed with `irm ... | iex`, which
# parses the WHOLE file before running any of it. So a single syntax error does
# not degrade the run - it kills it outright, with a message about line 87 of a
# script the participant never asked to read.
#
# That happened: `"$Label: winget finished"` is invalid, because PowerShell reads
# `$Label:` as a scope-qualified variable like `$env:` or `$global:`. The fix is
# `${Label}`, and no amount of reading it back catches that class reliably.
# bash -n has no equivalent here, so use the real parser.
#
# pwsh is available on macOS and Linux via `brew install powershell`, apt, or
# `winget install Microsoft.PowerShell`. Without it this exits 0 with a warning
# rather than blocking - a missing linter must not stop a release, but it should
# say so out loud.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO/desk/public/go.ps1"

[ -f "$SCRIPT" ] || { echo "not found: $SCRIPT"; exit 1; }

if ! command -v pwsh >/dev/null 2>&1; then
  echo "! pwsh not installed - cannot parse go.ps1"
  echo "  install it with: brew install powershell"
  echo "  (skipping rather than failing, but this check did NOT run)"
  exit 0
fi

pwsh -NoProfile -Command "
  \$errors = \$null; \$tokens = \$null
  [System.Management.Automation.Language.Parser]::ParseFile('$SCRIPT', [ref]\$tokens, [ref]\$errors) | Out-Null

  if (\$errors) {
    Write-Host \"go.ps1: \$(\$errors.Count) parse error(s) - participants would see this instead of a setup\"
    \$errors | ForEach-Object {
      Write-Host (\"  line {0} col {1}: {2}\" -f \$_.Extent.StartLineNumber, \$_.Extent.StartColumnNumber, \$_.Message)
    }
    exit 1
  }

  # Beyond parsing: the two things that have actually gone wrong in this file.
  \$src = Get-Content '$SCRIPT' -Raw
  \$problems = @()

  # The CLAUDE.md marker require-brief.sh greps for. If go.ps1 stops writing it,
  # the brief gate silently does nothing for every Windows participant.
  if (\$src -notmatch 'Brainstorm first, and only about the product') {
    \$problems += 'the CLAUDE.md marker is missing - require-brief.sh will not fire for Windows users'
  }

  # --disable-interactivity suppresses the UAC prompt that asks for the admin
  # password, which is how Git and Node get installed on a managed laptop.
  # Comment lines are stripped first: go.ps1 documents why the flag is absent,
  # and a linter that trips over its own explanation is worse than no linter.
  \$code = (Get-Content '$SCRIPT' | Where-Object { \$_.TrimStart() -notlike '#*' }) -join \"\`n\"
  if (\$code -match '--disable-interactivity') {
    \$problems += '--disable-interactivity is back - it hides the UAC password prompt'
  }

  if (\$problems) {
    \$problems | ForEach-Object { Write-Host \"  \$_\" }
    exit 1
  }

  Write-Host \"go.ps1 parses cleanly (\$(\$tokens.Count) tokens), marker present, no interactivity suppression\"
"
