#!/usr/bin/env bash
# Smallest check that fails if CleverTap stops being read-only.
# Run: bash plugin/hooks/scripts/test-block-clevertap-writes.sh
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/block-clevertap-writes.sh"
pass=0; fail=0

# Every write tool clevertap-mcp@1.0.0 registers, plus the dashboard tools the
# repo's main branch adds, plus an unknown future name. The full inventory is
# listed on purpose: this is the only control, so "we blocked the ones we
# remembered" is not good enough.
for name in clevertap_create_campaign clevertap_stop_campaign \
            clevertap_request clevertap_configure \
            clevertap_upload_events clevertap_upload_profile \
            clevertap_upload_device_token clevertap_delete_profile \
            clevertap_demerge_profile clevertap_subscribe \
            clevertap_disassociate_phone \
            clevertap_web_login clevertap_web_request \
            clevertap_web_session_status clevertap_send_test_push \
            clevertap_get_campaigns_ui \
            clevertap_unknown_future_tool clevertap_bulk_delete_profiles; do
  out="$(printf '{"tool_name":"mcp__clevertap__%s"}' "$name" | bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: $name was NOT denied"; fail=$((fail+1))
  fi
done

# Reads must pass untouched - an empty response means "no opinion, carry on".
# clevertap_get_campaigns_ui is deliberately absent: it matches get_* by shape but
# is a dashboard session-replay tool, so it belongs in the deny loop above. That
# assertion is what caught the original allowlist-before-deny ordering bug.
for name in clevertap_get_profile clevertap_get_events clevertap_get_event_count \
            clevertap_get_profiles_by_event clevertap_get_profiles_cursor \
            clevertap_get_profile_count clevertap_get_campaigns \
            clevertap_get_campaign_report clevertap_get_message_report \
            clevertap_get_event_trend clevertap_get_dau \
            clevertap_get_uninstall_report clevertap_get_real_time_counts \
            clevertap_get_top_property_count \
            clevertap_list_projects clevertap_poll; do
  out="$(printf '{"tool_name":"mcp__clevertap__%s"}' "$name" | bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: $name was blocked but should be allowed: $out"; fail=$((fail+1))
  fi
done

# An override env var must NOT re-enable writes. There is deliberately no escape
# hatch, and this is the check that keeps it that way.
for var in INSURWRECK_ALLOW_CLEVERTAP_WRITES CLEVERTAP_ALLOW_WRITES; do
  out="$(printf '{"tool_name":"mcp__clevertap__clevertap_create_campaign"}' \
    | env "$var=1" bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: $var re-enabled CleverTap writes"; fail=$((fail+1))
  fi
done

# Malformed input must fail open rather than block every CleverTap call.
for payload in '' 'not json' '{}'; do
  out="$(printf '%s' "$payload" | bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: malformed input produced a decision: $out"; fail=$((fail+1))
  fi
done

echo "clevertap write-block: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
