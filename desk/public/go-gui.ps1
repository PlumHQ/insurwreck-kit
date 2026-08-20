#
#   irm https://insurwreck-desk.preview.plumhq.com/win-gui | iex
#
# The Claude-app path for Windows. Same installer as /win, in desktop mode.
#
# This exists as its own URL rather than asking a participant to paste
# `$env:INSURWRECK_DESKTOP=1;` in front of the command. That prefix is the
# single most retypeable thing in this kit, and PowerShell cannot take an
# argument through `irm | iex` any other way.

$env:INSURWRECK_DESKTOP = '1'
Invoke-RestMethod -Uri 'https://insurwreck-desk.preview.plumhq.com/win' | Invoke-Expression
