#!/usr/bin/env bash
#
#   curl -fsSL https://insurwreck-desk.preview.plumhq.com/gui | bash
#
# The Claude-app path for macOS. Same installer as /go.sh, run with the flags
# that skip Ghostty and the Claude Code install, because someone reading this
# from inside Claude Code already has both.
#
# This exists as its own URL rather than asking a participant to paste
# `bash -s -- --desktop`. That is four pieces of punctuation with no meaning to
# them, and a mistyped one fails in a way they cannot read.

set -eu
GO_URL="${INSURWRECK_SELF_URL:-https://insurwreck-desk.preview.plumhq.com/go.sh}"
self="$(mktemp "${TMPDIR:-/tmp}/insurwreck-go.XXXXXX")"
curl -fsSL "$GO_URL" -o "$self"
exec bash "$self" --desktop
