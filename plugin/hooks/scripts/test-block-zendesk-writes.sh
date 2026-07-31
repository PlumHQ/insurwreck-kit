#!/usr/bin/env bash
# Smallest check that fails if Zendesk stops being read-only.
# Run: bash plugin/hooks/scripts/test-block-zendesk-writes.sh
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/block-zendesk-writes.sh"
pass=0; fail=0

# Writes must be denied. zendesk_add_public_note is the one that emails a real
# customer; unknown_future_tool is why the allowlist is by verb, not by name.
for name in zendesk_add_public_note zendesk_add_private_note \
            zendesk_create_ticket zendesk_update_ticket \
            zendesk_unknown_future_tool zendesk_delete_ticket; do
  out="$(printf '{"tool_name":"mcp__zendesk__%s"}' "$name" | bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: $name was NOT denied"; fail=$((fail+1))
  fi
done

# Reads must pass untouched - an empty response means "no opinion, carry on".
for name in zendesk_search zendesk_get_ticket zendesk_get_ticket_details \
            zendesk_get_linked_incidents; do
  out="$(printf '{"tool_name":"mcp__zendesk__%s"}' "$name" | bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: $name was blocked but should be allowed: $out"; fail=$((fail+1))
  fi
done

# An override env var must NOT re-enable writes - there is deliberately no
# escape hatch, and this is the check that keeps it that way.
out="$(printf '{"tool_name":"mcp__zendesk__zendesk_add_public_note"}' \
  | INSURWRECK_ALLOW_ZENDESK_WRITES=1 bash "$HOOK")"
if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
  pass=$((pass+1))
else
  echo "FAIL: an env var re-enabled Zendesk writes"; fail=$((fail+1))
fi

# Malformed input must fail open rather than block every Zendesk call.
for payload in '' 'not json' '{}'; do
  out="$(printf '%s' "$payload" | bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: malformed input produced a decision: $out"; fail=$((fail+1))
  fi
done

echo "zendesk write-block: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
