#!/usr/bin/env bash
# Smallest check that fails if Kula stops being read-only.
# Run: bash plugin/hooks/scripts/test-block-kula-writes.sh
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/block-kula-writes.sh"
pass=0; fail=0

# Writes must be denied. The unknown_future_tool case is the point of the
# verb-allowlist: a write tool added in a later release blocks on day one.
for name in create_candidate update_candidate update_application_stage \
            create_application_note update_application_note \
            create_webhook update_webhook delete_webhook \
            create_job_stage create_requisition update_requisition \
            unknown_future_tool bulk_reject_applications; do
  out="$(printf '{"tool_name":"mcp__kula__%s"}' "$name" | bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: $name was NOT denied"; fail=$((fail+1))
  fi
done

# Reads must pass untouched - an empty response means "no opinion, carry on".
for name in list_jobs get_candidate search_candidates list_applications \
            autocomplete_users list_scorecard_submissions; do
  out="$(printf '{"tool_name":"mcp__kula__%s"}' "$name" | bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: $name was blocked but should be allowed: $out"; fail=$((fail+1))
  fi
done

# An override env var must NOT re-enable writes - there is deliberately no
# escape hatch, and this is the check that keeps it that way.
out="$(printf '{"tool_name":"mcp__kula__create_candidate"}' \
  | INSURWRECK_ALLOW_KULA_WRITES=1 bash "$HOOK")"
if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
  pass=$((pass+1))
else
  echo "FAIL: an env var re-enabled Kula writes"; fail=$((fail+1))
fi

# Malformed input must fail open rather than block every Kula call.
for payload in '' 'not json' '{}'; do
  out="$(printf '%s' "$payload" | bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: malformed input produced a decision: $out"; fail=$((fail+1))
  fi
done

echo "kula write-block: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
