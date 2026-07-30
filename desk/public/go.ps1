# Insurwreck 4.0 - one-paste setup for Windows.
#
#   irm https://insurwreck-desk.preview.plumhq.com/win | iex
#
# Native Windows, normal terminal - no WSL, no reboot. Installs Claude Code, Git
# for Windows, Node 22+, the Salesforce CLI, the insurwreck plugin, and a project
# folder, then prints the line that starts you building.
#
# Git for Windows is NOT optional here even though Claude Code treats it as such.
# Every guardrail this kit ships is a bash script - the secret scanner, the
# destructive-command block, the Kula write block, the auto-checkpoint. Without a
# bash on the machine those silently do not run, and the kit launches Claude in
# auto permission mode on the assumption that they do. So Git for Windows is
# installed and CLAUDE_CODE_GIT_BASH_PATH is pinned explicitly.
#
# Safe to re-run. Every step checks before it acts.

$ErrorActionPreference = 'Stop'

$KitRepo    = if ($env:INSURWRECK_MARKETPLACE) { $env:INSURWRECK_MARKETPLACE } else { 'PlumHQ/insurwreck-kit' }
$ProjectDir = if ($env:INSURWRECK_DIR) { $env:INSURWRECK_DIR } else { Join-Path $HOME 'insurwreck' }
$MinNode    = 22
$TotalSteps = 7
$script:Step = 0

function Write-Step { $script:Step++; Write-Host ""; Write-Host "[$script:Step/$TotalSteps] $args" -ForegroundColor Cyan }
function Write-Ok   { Write-Host "      + $args" -ForegroundColor Green }
function Write-Skip { Write-Host "      . $args" -ForegroundColor DarkGray }
function Write-Warn { Write-Host "      ! $args" -ForegroundColor Yellow }
function Write-Info { Write-Host "      $args" }
function Write-Die  { Write-Host ""; Write-Host "x $args" -ForegroundColor Red; Write-Host ""; exit 1 }
function Test-Have  { param($n) [bool](Get-Command $n -ErrorAction SilentlyContinue) }

# An install puts things on the machine PATH, but not into the PATH this session
# already captured - so `claude` or `npm` would be missing for the rest of the
# run. Re-read both scopes after every install.
function Sync-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $extra   = @(
    (Join-Path $HOME '.local\bin'),
    (Join-Path $env:APPDATA 'npm'),
    'C:\Program Files\Git\cmd',
    'C:\Program Files\nodejs'
  ) -join ';'
  $env:Path = "$machine;$user;$extra"
}

# Sync-Path only fixes the RUNNING session. Claude Code's own installer says it
# plainly - "Native installation exists but ...\.local\bin is not in your PATH" -
# and without persisting it the participant closes this window and `claude` is
# gone. go.sh has a whole step for this on macOS; this is its other half.
#
# User scope only: Machine scope needs administrator, and this command is
# deliberately not run elevated. Read-modify-write, never blind overwrite - this
# is the participant's real PATH.
function Add-ToUserPath {
  param([string]$Dir)
  if (-not $Dir) { return $false }
  $Dir = $Dir.TrimEnd('\')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $user) { $user = '' }
  $parts = @($user.Split(';') | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.TrimEnd('\') })
  if ($parts -contains $Dir) { return $false }
  [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
  return $true
}

function Install-WinGetPackage {
  param($Id, $Label)
  if (-not (Test-Have 'winget')) { return $false }
  winget install --exact --id $Id --silent `
    --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
  Sync-Path
  return $true
}

Write-Host @"

  INSURWRECK 4.0
  Leadership Hackathon | 31 July 2026 | Plum

  Bring one real problem. Leave with a working prototype.

"@ -ForegroundColor White

# ------------------------------------------------------------- 1 preflight ---

Write-Step "Checking your machine"

if ($PSVersionTable.PSEdition -eq 'Desktop' -and $PSVersionTable.PSVersion.Major -lt 5) {
  Write-Die "This needs PowerShell 5 or newer. Search 'PowerShell' in the Start menu and use that window."
}

$build = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name CurrentBuild).CurrentBuild
if ($build -lt 17763) {
  Write-Die "Claude Code needs Windows 10 1809 or newer (build 17763+). This machine reports $build."
}
Write-Ok "Windows build $build"

if (-not (Test-Have 'winget')) {
  Write-Die @"
winget is missing, and it is how this installs Git and Node.

  Install 'App Installer' from the Microsoft Store, then re-run this command.
  If your IT policy blocks the Store, tell an organiser - there is a WSL route.
"@
}
Write-Ok "winget available"

try {
  Invoke-WebRequest -Uri 'https://claude.ai/install.ps1' -UseBasicParsing -TimeoutSec 15 | Out-Null
  Write-Ok "network reaches claude.ai"
} catch {
  Write-Die "Can't reach claude.ai - check your wifi or VPN, then re-run.`n  On a corporate network, try a phone hotspot."
}

# ----------------------------------------------------------- 2 claude code ---

Write-Step "Installing Claude Code"

if (Test-Have 'claude') {
  Write-Ok "already installed ($(claude --version 2>$null | Select-Object -First 1))"
} else {
  Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1')
  Sync-Path
  if (Test-Have 'claude') { Write-Ok "installed" }
  else { Write-Die "Claude Code installed but 'claude' still isn't found. Close this window, open a new one, and re-run." }
}

# Claude Code installs to ~\.local\bin and tells you to add it to PATH by hand
# through System Properties. Do it here instead, so `claude` still works tomorrow
# morning in a terminal that isn't this one.
$localBin = Join-Path $HOME '.local\bin'
$added = @()
if (Test-Path $localBin) { if (Add-ToUserPath $localBin) { $added += '~\.local\bin' } }
$npmBin = Join-Path $env:APPDATA 'npm'
if (Test-Path $npmBin) { if (Add-ToUserPath $npmBin) { $added += '%APPDATA%\npm' } }

if ($added.Count -gt 0) {
  Write-Ok "added to your PATH for future terminals: $($added -join ', ')"
} else {
  Write-Ok "already on your PATH"
}

# ------------------------------------------------------- 3 git for windows ---
# This is the step that keeps the guardrails alive. See the header.

Write-Step "Installing Git (this is what keeps the safety checks working)"

if (Test-Have 'git') {
  Write-Ok "git already installed ($(git --version))"
} else {
  Write-Info "downloading Git for Windows..."
  Install-WinGetPackage -Id 'Git.Git' | Out-Null
  if (Test-Have 'git') { Write-Ok "git installed" }
  else { Write-Warn "git did not install - tell an organiser before you start building" }
}

# Pin the bash path so Claude Code uses Git Bash for the Bash tool rather than
# falling back to PowerShell, which would leave every hook in this kit inert.
$bashCandidates = @(
  'C:\Program Files\Git\bin\bash.exe',
  'C:\Program Files (x86)\Git\bin\bash.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
)
$bash = $bashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($bash) {
  $settingsPath = Join-Path $HOME '.claude\settings.json'
  New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath) | Out-Null
  $settings = if (Test-Path $settingsPath) {
    try { Get-Content $settingsPath -Raw | ConvertFrom-Json } catch { [pscustomobject]@{} }
  } else { [pscustomobject]@{} }

  if (-not $settings.PSObject.Properties.Name.Contains('env')) {
    $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  $settings.env | Add-Member -NotePropertyName CLAUDE_CODE_GIT_BASH_PATH -NotePropertyValue $bash -Force

  # Merge, never overwrite: this file also holds the participant's MCP tokens.
  $settings | ConvertTo-Json -Depth 12 | Set-Content -Path $settingsPath -Encoding utf8
  Write-Ok "safety checks wired to Git Bash"
} else {
  Write-Warn "couldn't find Git Bash, so the kit's safety checks may not run"
  Write-Info "tell an organiser - do not start building in auto mode without them"
}

# ------------------------------------------------------------------ 4 node ---
# @kula-ai/mcp-server declares node >=22 and @salesforce/mcp >=20. An older node
# leaves those servers dead with no obvious cause, so check the version.

Write-Step "Setting up the Salesforce and Kula tools"

function Get-NodeMajor {
  if (-not (Test-Have 'node')) { return 0 }
  $v = (node --version 2>$null) -replace '^v', ''
  if (-not $v) { return 0 }
  return [int]($v.Split('.')[0])
}

$nodeMajor = Get-NodeMajor
if ($nodeMajor -ge $MinNode) {
  Write-Ok "node $(node --version)"
} else {
  if ($nodeMajor -gt 0) { Write-Info "node v$nodeMajor is too old for the Salesforce and Kula servers; installing $MinNode+..." }
  else { Write-Info "installing node..." }
  Install-WinGetPackage -Id 'OpenJS.NodeJS.LTS' | Out-Null
  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -ge $MinNode) { Write-Ok "node $(node --version)" }
  else { Write-Warn "node $MinNode+ did not install - get it from https://nodejs.org, then run iw-doctor" }
}

if (Test-Have 'npm') {
  if (Test-Have 'sf') {
    Write-Skip "salesforce cli already installed"
  } else {
    npm install -g @salesforce/cli 2>&1 | Out-Null
    Sync-Path
    if (Test-Have 'sf') { Write-Ok "salesforce cli installed" }
    else { Write-Warn "salesforce cli didn't install - run: npm i -g @salesforce/cli" }
  }

  # Populate the npx cache so the first MCP launch isn't racing its own download.
  foreach ($pkg in @('@salesforce/mcp', '@kula-ai/mcp-server')) {
    npx -y $pkg --version 2>&1 | Out-Null
    Write-Ok "cached $pkg"
  }
} else {
  Write-Warn "no npm, so the salesforce and kula servers will not start"
}

# ---------------------------------------------------------------- 5 plugin ---
# git is installed by now, so the plain marketplace path works - and unlike the
# macOS tarball route this is a real git clone, so /insurwreck:update can pull.

Write-Step "Installing the Insurwreck plugin"

claude plugin marketplace add $KitRepo 2>&1 | Out-Null
claude plugin install insurwreck@insurwreck-kit --scope user 2>&1 | Out-Null

# Exit codes here don't distinguish "already installed" from "couldn't reach the
# repo", so ask what is actually installed instead.
if ((claude plugin list 2>$null) -match 'insurwreck@insurwreck-kit') {
  Write-Ok "plugin installed"
} else {
  Write-Die @"
The Insurwreck plugin did not install.

  Everything else is set up, so this is recoverable. Show an organiser this
  screen, then try:

      claude plugin marketplace add $KitRepo
      claude plugin install insurwreck@insurwreck-kit --scope user
"@
}

# -------------------------------------------------------- 6 project folder ---

Write-Step "Creating your project folder"

if (Test-Path $ProjectDir) {
  Write-Skip "$ProjectDir already exists"
} else {
  New-Item -ItemType Directory -Force -Path $ProjectDir | Out-Null
  Write-Ok "created $ProjectDir"
}

$gitignore = Join-Path $ProjectDir '.gitignore'
if (-not (Test-Path $gitignore)) {
  @'
.env*
.insurwreck*
node_modules/
.vercel
.DS_Store
'@ | Set-Content -Path $gitignore -Encoding utf8
  Write-Ok "added a .gitignore that keeps your keys out of git"
}

# The same contract go.sh writes on macOS. The "Brainstorm first, and only about
# the product" line is load-bearing: require-brief.sh greps for it to decide
# whether this is a participant project, so keep the two in step.
$claudeMd = Join-Path $ProjectDir 'CLAUDE.md'
if (-not (Test-Path $claudeMd)) {
  @'
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
'@ | Set-Content -Path $claudeMd -Encoding utf8
  Write-Ok "added CLAUDE.md so the build starts with a conversation, not a code dump"
}

# ------------------------------------------------------------- 7 hand off ----

Write-Step "Ready"

Write-Host @"

  Everything is installed.

  Your project folder:  $ProjectDir
  Next:                 run /insurwreck:start inside Claude Code

  Paste this to begin:

      cd "$ProjectDir" ; claude --permission-mode auto

"@ -ForegroundColor White

# `irm | iex` gives no interactive stdin, so handing over to a live session is
# not possible - the line above is the handover.
