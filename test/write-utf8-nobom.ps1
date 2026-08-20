# Exercise go.ps1's Write-Utf8NoBom for real, on any platform.
#
# It is pure .NET, so it runs identically on macOS pwsh and Windows PowerShell -
# which makes it the one Windows-path change that CAN be executed without a
# Windows machine. Worth doing: every file go.ps1 writes now routes through it,
# including the participant's own ~/.claude/settings.json, so a runtime fault
# here is worse than the BOM it replaced.

$ErrorActionPreference = 'Stop'
$goPs1 = Join-Path (Split-Path -Parent $PSScriptRoot) 'desk/public/go.ps1'
$src   = Get-Content $goPs1 -Raw
$m     = [regex]::Match($src, '(?ms)^function Write-Utf8NoBom \{.*?^\}')
if (-not $m.Success) { Write-Host 'FAIL: Write-Utf8NoBom not found in go.ps1'; exit 1 }
Invoke-Expression $m.Value

$fail = 0
function Check($label, $cond) {
  if ($cond) { Write-Host "  ok   $label" }
  else { Write-Host "  FAIL $label"; $script:fail++ }
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ("iw-" + [guid]::NewGuid())

# The project settings.json case: a nested directory that does not exist yet.
$settings = Join-Path $root '.claude/settings.json'
Write-Utf8NoBom -Path $settings -Text '{ "enabledPlugins": ["insurwreck@insurwreck-kit"] }'
$sb = [System.IO.File]::ReadAllBytes($settings)
Check 'creates missing parent directories' (Test-Path $settings)
Check 'settings.json has no BOM'          (-not ($sb[0] -eq 0xEF -and $sb[1] -eq 0xBB -and $sb[2] -eq 0xBF))
Check 'settings.json parses as JSON'      ([bool](Get-Content $settings -Raw | ConvertFrom-Json))

# The .gitignore case. A BOM here makes git read the first pattern as
# "<BOM>.env*", which silently stops ignoring the participant's credentials.
$gitignore = Join-Path $root '.gitignore'
Write-Utf8NoBom -Path $gitignore -Text ".env*`r`nnode_modules/`r`n"
$gb = [System.IO.File]::ReadAllBytes($gitignore)
$firstFour = ($gb[0..3] | ForEach-Object { $_.ToString('X2') }) -join ' '
Check "first bytes are the pattern, not a BOM (got $firstFour)" ($firstFour -eq '2E 65 6E 76')
Check 'CRLF normalised to LF'             (-not ($gb -contains 13))

# Re-running the installer must overwrite cleanly, not append or fail.
Write-Utf8NoBom -Path $gitignore -Text ".env*`n"
Check 'overwrites an existing file'       ((Get-Content $gitignore -Raw).Trim() -eq '.env*')

Remove-Item -Recurse -Force $root
if ($fail -gt 0) { Write-Host "$fail check(s) failed"; exit 1 }
Write-Host 'ok - Write-Utf8NoBom: no BOM, LF only, creates parents, overwrites'
