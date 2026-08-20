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

# 'Continue', not 'Stop', and deliberately so. With 'Stop', PowerShell turns a
# native command's stderr into a terminating error - so one warning line from
# winget, npm or claude aborts the whole setup and the participant never reaches
# the plugin or the project folder. Both real Windows failures so far ended that
# way: a marketplace error at step 5, and an ExecutionPolicy refusal at step 4,
# each killing everything after it.
#
# Nothing here relies on exceptions to know whether it worked. Every step
# verifies the capability it wanted - Test-Have git, node --version against the
# floor, claude plugin list - so failures are caught by checking the outcome
# rather than by trusting the command. Network calls that genuinely need to fail
# loudly have their own try/catch.
$ErrorActionPreference = 'Continue'

$KitRepo    = if ($env:INSURWRECK_MARKETPLACE) { $env:INSURWRECK_MARKETPLACE } else { 'PlumHQ/insurwreck-kit' }
$ProjectDir = if ($env:INSURWRECK_DIR) { $env:INSURWRECK_DIR } else { Join-Path $HOME 'insurwreck' }
$MinNode    = 22
# Claude Code Desktop users are reading this from inside Claude Code, so there is
# nothing here to install for it. An env var rather than a param because
# `irm | iex` cannot pass arguments to the script it pipes.
$Desktop    = ($env:INSURWRECK_DESKTOP -eq '1')
$TotalSteps = 7
$script:Step = 0

function Write-Step { $script:Step++; Write-Host ""; Write-Host "[$script:Step/$TotalSteps] $args" -ForegroundColor Cyan }
function Write-Ok   { Write-Host "      + $args" -ForegroundColor Green }
function Write-Skip { Write-Host "      . $args" -ForegroundColor DarkGray }
function Write-Warn { Write-Host "      ! $args" -ForegroundColor Yellow }
function Write-Info { Write-Host "      $args" }
function Write-Die  { Write-Host ""; Write-Host "x $args" -ForegroundColor Red; Write-Host ""; exit 1 }
function Test-Have  { param($n) [bool](Get-Command $n -ErrorAction SilentlyContinue) }

# Every file this script writes goes through here, and never through
# `Set-Content -Encoding utf8`. On Windows PowerShell 5.1 - the default on a
# Windows laptop - that switch prepends a UTF-8 BOM (EF BB BF), and three of the
# files we write are parsed by something that will not tolerate it:
#
#   .gitignore  git treats the BOM as part of the first pattern, so the first
#               rule silently fails. Our first rule is `.env*`, which is where
#               every credential we mint for them lives.
#   settings.json (both the participant's global one and the project one)
#               read by Node, whose JSON.parse throws on a leading BOM.
#
# Nothing warns. The files look correct in Notepad. Write them BOM-free and also
# with LF, so a hook reading them under Git Bash does not meet a stray CR.
function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"),
    (New-Object System.Text.UTF8Encoding($false)))
}

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

# Do NOT suppress winget's output. These downloads are tens of megabytes and can
# take minutes on a corporate network; with the progress bar swallowed, a slow
# step is indistinguishable from a hang and people kill the window mid-install.
# go.sh had exactly this bug with a hidden sudo prompt - same mistake, other shell.
#
# And do NOT pass --disable-interactivity. Git and Node install machine-wide, so
# Windows raises a UAC prompt; on a managed laptop that prompt asks for an
# administrator password, which the participant may well have. Disabling
# interactivity suppresses the one dialog they need to answer.
function Install-WinGetPackage {
  param($Id, $Label, $Expect)
  if (-not (Test-Have 'winget')) { return $false }
  if ($Expect) { Write-Info "$Label - usually $Expect. Progress below; leave this window open." }
  Write-Info "Windows may ask for an administrator password. Enter it if prompted."
  $started = Get-Date
  winget install --exact --id $Id --silent `
    --accept-source-agreements --accept-package-agreements
  Sync-Path
  Write-Info "${Label}: winget finished in $([int]((Get-Date) - $started).TotalSeconds)s"
  # Exit codes are not a reliable signal here - winget returns non-zero for
  # "already installed" and zero for some partial installs. Callers verify the
  # capability instead, which is the only thing that actually matters.
}

# No-admin fallbacks. Portable extraction into the user profile needs no
# installer and no elevation, so a machine where the password is unavailable
# still ends up working rather than half-configured.
function Install-PortableNode {
  $ver = 'v22.14.0'
  $dest = Join-Path $HOME '.local'
  $dir  = Join-Path $dest "node-$ver-win-x64"
  if (Test-Path (Join-Path $dir 'node.exe')) { $env:Path = "$dir;$env:Path"; return $true }
  try {
    $zip = Join-Path $env:TEMP "node-$ver.zip"
    Write-Info "fetching a portable Node ($ver, no installer needed)..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip -UseBasicParsing
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $env:Path = "$dir;$env:Path"
    Add-ToUserPath $dir | Out-Null
    return (Test-Path (Join-Path $dir 'node.exe'))
  } catch { return $false }
}

function Install-PortableGit {
  $dir = Join-Path $HOME '.local\git'
  if (Test-Path (Join-Path $dir 'bin\bash.exe')) { $env:Path = "$dir\cmd;$env:Path"; return $true }
  # Resolve the current PortableGit asset, with a pinned fallback - the same
  # shape as the Ghostty resolver in go.sh, and for the same reason.
  $url = $null
  try {
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -UseBasicParsing
    $url = ($rel.assets | Where-Object { $_.name -match 'PortableGit.*64-bit\.7z\.exe$' } | Select-Object -First 1).browser_download_url
  } catch { }
  if (-not $url) {
    $url = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/PortableGit-2.55.0.3-64-bit.7z.exe'
  }
  try {
    $exe = Join-Path $env:TEMP 'PortableGit.7z.exe'
    Write-Info "fetching a portable Git (~56 MB, no installer needed)..."
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
    & $exe "-o$dir" -y | Out-Null
    Remove-Item $exe -Force -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $dir 'bin\bash.exe')) {
      $env:Path = "$dir\cmd;$env:Path"
      Add-ToUserPath (Join-Path $dir 'cmd') | Out-Null
      return $true
    }
    return $false
  } catch { return $false }
}

# npm on Windows ships npm.ps1, npm.cmd and npm. From PowerShell, bare `npm`
# resolves to npm.ps1 - and on a managed laptop ExecutionPolicy refuses to load
# it: "running scripts is disabled on this system". The .cmd shim is not a
# PowerShell script, so it is not subject to that policy at all.
#
# Set-ExecutionPolicy -Scope Process would also work, except when the policy
# comes from Group Policy, which is exactly where it comes from on a managed
# laptop. So resolve the shim rather than fighting the policy.
function Resolve-NodeTool {
  param([string]$Name)   # 'npm' or 'npx'
  foreach ($candidate in @("$Name.cmd", $Name)) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue |
           Where-Object { $_.Source -notlike '*.ps1' } |
           Select-Object -First 1
    if ($cmd) { return $cmd.Source }
  }
  # winget's Node lands here; PATH may not have caught up within this session.
  $fallback = 'C:\Program Files\nodejs\' + "$Name.cmd"
  if (Test-Path $fallback) { return $fallback }
  return $null
}

function Find-GitBash {
  @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe'),
    (Join-Path $HOME '.local\git\bin\bash.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

Write-Host @"

  INSURWRECK 4.0
  Leadership Hackathon | 31 July 2026 | Plum

  Bring one real problem. Leave with a working prototype.

  On a machine with none of this installed, expect 8 to 15 minutes - most of it
  downloading. Some steps sit quiet for minutes at a time. That is normal; leave
  the window open.

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

if ($Desktop) {
  # Still a step: the PATH work below is what makes node and npm visible to the
  # app tomorrow. Only the install goes away - they are already running it.
  Write-Step "Making the new tools available"
} else {
  Write-Step "Installing Claude Code"

  if (Test-Have 'claude') {
    Write-Ok "already installed ($(claude --version 2>$null | Select-Object -First 1))"
  } else {
    Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1')
    Sync-Path
    if (Test-Have 'claude') { Write-Ok "installed" }
    else { Write-Die "Claude Code installed but 'claude' still isn't found. Close this window, open a new one, and re-run." }
  }
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
  Install-WinGetPackage -Id 'Git.Git' -Label 'Git for Windows (~70 MB)' -Expect '1-3 minutes'
  if (-not (Test-Have 'git')) {
    Write-Warn "the Git installer did not complete - falling back to a portable copy"
    Install-PortableGit | Out-Null
  }
  if (Test-Have 'git') { Write-Ok "git installed ($(git --version))" }
  else { Write-Warn "git is still missing - the safety checks below will not run" }
}

# Pin the bash path so Claude Code uses Git Bash for the Bash tool rather than
# falling back to PowerShell, which would leave every hook in this kit inert.
$bash = Find-GitBash

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
  # And write it BOM-free. `-Encoding utf8` on Windows PowerShell 5.1 - the
  # default on a Windows laptop - prepends EF BB BF, and Node's JSON.parse
  # throws on a leading BOM. That would corrupt the participant's own global
  # settings file, tokens and all, while looking perfect in Notepad.
  Write-Utf8NoBom -Path $settingsPath -Text ($settings | ConvertTo-Json -Depth 12)
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
  Install-WinGetPackage -Id 'OpenJS.NodeJS.LTS' -Label 'Node (~30 MB)' -Expect '1-2 minutes'
  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -lt $MinNode) {
    Write-Warn "the Node installer did not give us $MinNode+ - falling back to a portable copy"
    Install-PortableNode | Out-Null
    $nodeMajor = Get-NodeMajor
  }
  if ($nodeMajor -ge $MinNode) { Write-Ok "node $(node --version)" }
  else { Write-Warn "node $MinNode+ is missing - the salesforce and kula servers will not start" }
}

if (Test-Have 'npm') {
  $npm = Resolve-NodeTool 'npm'
  $npx = Resolve-NodeTool 'npx'

  # Everything from here is optional polish. $ErrorActionPreference is 'Stop', so
  # without these try/catch blocks a refused npm script aborts the entire run and
  # the participant never reaches the plugin, the project folder, or the CLAUDE.md
  # - which is exactly what happened: an ExecutionPolicy error at step 4 meant
  # steps 5 to 7 never executed. The plugin matters far more than the CLI.
  if (-not $npm) {
    Write-Warn "couldn't find a usable npm - skipping the Salesforce CLI"
  } elseif (Test-Have 'sf') {
    Write-Skip "salesforce cli already installed"
  } else {
    Write-Info "Salesforce CLI - the biggest download here, usually 3-6 minutes."
    Write-Info "npm prints little while it works; that is normal, not a hang."
    $sfStart = Get-Date
    try {
      & $npm install -g @salesforce/cli --loglevel http
      Write-Info "Salesforce CLI finished in $([int]((Get-Date) - $sfStart).TotalSeconds)s"
      Sync-Path
    } catch {
      Write-Warn "salesforce cli install failed: $($_.Exception.Message)"
    }
    if (Test-Have 'sf') { Write-Ok "salesforce cli installed" }
    else { Write-Warn "salesforce cli is missing - Salesforce tools will not work until it is installed" }
  }

  # Populate the npx cache so the first MCP launch isn't racing its own download.
  if ($npx) {
    $pkgs = @('@salesforce/mcp', '@kula-ai/mcp-server', 'zd-mcp-server', 'clevertap-mcp@1.0.0')
    for ($i = 0; $i -lt $pkgs.Count; $i++) {
      Write-Info "caching $($pkgs[$i]) ($($i + 1) of $($pkgs.Count)) - about a minute each"
      try {
        & $npx -y $pkgs[$i] --version 2>&1 | Out-Null
        Write-Ok "cached $($pkgs[$i])"
      } catch {
        Write-Skip "$($pkgs[$i]) will download on first use"
      }
    }
  }
} else {
  Write-Warn "no npm, so the salesforce and kula servers will not start"
}

# ---------------------------------------------------------------- 5 plugin ---
# git is installed by now, so the plain marketplace path works - and unlike the
# macOS tarball route this is a real git clone, so /insurwreck:update can pull.

Write-Step "Installing the Insurwreck plugin"

$PluginViaUi = $false
if ($Desktop -and -not (Test-Have 'claude')) {
  # The app owns its plugin list, and it injects a `claude` shim only into the
  # shells it opens itself - so a missing one here is normal, not a failure.
  # Step 6 points the project folder at the marketplace instead.
  Write-Skip "the Claude app installs this one - the folder points it there"
  $PluginViaUi = $true
} else {

# `claude plugin marketplace add owner/repo` shells out to git clone. go.sh
# deliberately avoids that on macOS - a fresh machine may have no usable git -
# and Windows deserves the same treatment. A downloaded zip needs nothing but
# Invoke-WebRequest and Expand-Archive, both built into PowerShell 5.
# This is what failed as "Command 'git' not found or is in an unsafe location"
# on a laptop where the Git install had silently not completed.
function Install-KitFromZip {
  $dir = Join-Path $HOME '.insurwreck\kit'
  try {
    $zip = Join-Path $env:TEMP 'insurwreck-kit.zip'
    Invoke-WebRequest -Uri "https://codeload.github.com/$KitRepo/zip/refs/heads/main" -OutFile $zip -UseBasicParsing
    $staging = Join-Path $env:TEMP 'insurwreck-kit-staging'
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $staging -Force
    # Only swap in once the manifest is confirmed - a truncated download must not
    # leave the participant with no kit at all.
    $manifest = Get-ChildItem -Path $staging -Recurse -Filter 'marketplace.json' |
                Where-Object { $_.DirectoryName -like '*\.claude-plugin' } |
                Select-Object -First 1
    if (-not $manifest) { return $null }
    $root = Split-Path (Split-Path $manifest.FullName)
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Move-Item -Path $root -Destination $dir
    Remove-Item $zip, $staging -Recurse -Force -ErrorAction SilentlyContinue
    return (Join-Path $dir (Split-Path $root -Leaf))
  } catch { return $null }
}

$local = Install-KitFromZip
try {
  if ($local) {
    claude plugin marketplace add $local 2>&1 | Out-Null
  } else {
    Write-Info "zip download unavailable, trying git..."
    claude plugin marketplace add $KitRepo 2>&1 | Out-Null
  }
} catch { }
try { claude plugin install insurwreck@insurwreck-kit --scope user 2>&1 | Out-Null } catch { }

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
'@ | ForEach-Object { Write-Utf8NoBom -Path $gitignore -Text $_ }
  Write-Ok "added a .gitignore that keeps your keys out of git"
}

# Register the marketplace in the folder itself. Claude Code adds a marketplace
# named here once the folder is trusted, so the app offers the plugin by name
# instead of the participant hunting for the plugin browser.
$claudeDir = Join-Path $ProjectDir '.claude'
$settings  = Join-Path $claudeDir 'settings.json'
# Only an owner/repo can be written as a github source - see go.sh.
if ($KitRepo -notmatch '^[^/\\:]+/[^/\\:]+$') {
  Write-Skip "local marketplace - folder config skipped"
} elseif (-not (Test-Path $settings)) {
  New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
  @"
{
  "extraKnownMarketplaces": {
    "insurwreck-kit": {
      "source": { "source": "github", "repo": "$KitRepo" }
    }
  },
  "enabledPlugins": ["insurwreck@insurwreck-kit"]
}
"@ | ForEach-Object { Write-Utf8NoBom -Path $settings -Text $_ }
  Write-Ok "pointed this folder at the Insurwreck plugin"
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
'@ | ForEach-Object { Write-Utf8NoBom -Path $claudeMd -Text $_ }
  Write-Ok "added CLAUDE.md so the build starts with a conversation, not a code dump"
}

# ------------------------------------------------------------- 7 hand off ----

Write-Step "Ready"

Write-Host @"

  Everything is installed.

  Your project folder:  $ProjectDir
  Next:                 run /insurwreck:start inside Claude Code

"@ -ForegroundColor White

if ($Desktop) {
  # Restarting is not advice, it is the step: the app reads the user PATH at
  # launch, so a window that was already open cannot see the node just installed.
  Write-Host @"
  In the Claude app:

    1. Quit it completely and open it again  (needed - it reads your PATH at launch)
    2. Click the Code tab
    3. Open the folder  $ProjectDir
    4. Set the mode selector next to the send button to Auto
    5. Type  /insurwreck:start

"@ -ForegroundColor White
  if ($PluginViaUi) {
    Write-Host @"
    6. Click + next to the prompt box, choose Plugins, install insurwreck
       (say yes when it asks whether you trust this folder)

"@ -ForegroundColor White
  }
  if (-not (Find-GitBash)) {
    # Same reasoning as the terminal handover below: with no bash the hooks are
    # inert, and the participant should hear that from a person.
    Write-Host @"
  Note: Git Bash is not on this machine, so the kit's safety checks cannot run.
  Tell an organiser before you start building.

"@ -ForegroundColor Yellow
  }
  exit 0
}

# Auto permission mode is only defensible because the hooks run - block-secrets,
# block-destructive, block-kula-writes. Those are bash scripts. With no bash on
# the machine they are silently inert, and skipping the prompts as well would
# leave a participant with neither guard. So the handover changes shape.
if (Find-GitBash) {
  Write-Host @"
  Paste this to begin:

      cd "$ProjectDir" ; claude --permission-mode auto

  Once Claude Code starts, type /insurwreck:start

"@ -ForegroundColor White
} else {
  Write-Host @"
  Paste this to begin:

      cd "$ProjectDir" ; claude

  Once Claude Code starts, type /insurwreck:start

  Note: this starts WITHOUT auto-approve, on purpose. The kit's safety checks
  need Git Bash, which is not on this machine, so Claude will ask before each
  action instead. Tell an organiser - they can get git installed and you will
  get the smoother flow.

"@ -ForegroundColor Yellow
}

# `irm | iex` gives no interactive stdin, so handing over to a live session is
# not possible - the line above is the handover.
