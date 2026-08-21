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

# An INVENTED override must still not work. Only the one documented flag does, so
# a plausible-looking variable name someone guesses cannot widen anything.
for var in INSURWRECK_ALLOW_CLEVERTAP_WRITES CLEVERTAP_ALLOW_WRITES CLEVERTAP_WRITES; do
  out="$(printf '{"tool_name":"mcp__clevertap__clevertap_create_campaign"}' \
    | env "$var=1" bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: $var re-enabled CleverTap writes"; fail=$((fail+1))
  fi
done

# ACCESS=campaign permits EXACTLY two tools.
for name in clevertap_create_campaign clevertap_stop_campaign; do
  out="$(printf '{"tool_name":"mcp__clevertap__%s"}' "$name" \
    | env INSURWRECK_CLEVERTAP_ACCESS=campaign bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: ACCESS=campaign did not permit $name"; fail=$((fail+1))
  fi
done

# ...and widens NOTHING else. The assertion that matters: a grant meant for two
# campaign tools must not quietly hand over consent flags, profile deletion, or
# the arbitrary-path escape hatch.
for name in clevertap_request clevertap_upload_profile clevertap_upload_events \
            clevertap_upload_device_token clevertap_delete_profile \
            clevertap_demerge_profile clevertap_disassociate_phone \
            clevertap_subscribe clevertap_configure \
            clevertap_send_test_push clevertap_web_login \
            clevertap_unknown_future_tool; do
  out="$(printf '{"tool_name":"mcp__clevertap__%s"}' "$name" \
    | env INSURWRECK_CLEVERTAP_ACCESS=campaign bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: ACCESS=campaign widened $name, which it must not"; fail=$((fail+1))
  fi
done

# ACCESS=full permits the writes, deliberately.
for name in clevertap_create_campaign clevertap_stop_campaign clevertap_request \
            clevertap_upload_profile clevertap_delete_profile clevertap_subscribe \
            clevertap_demerge_profile clevertap_disassociate_phone; do
  out="$(printf '{"tool_name":"mcp__clevertap__%s"}' "$name" \
    | env INSURWRECK_CLEVERTAP_ACCESS=full bash "$HOOK")"
  if [ -z "$out" ]; then
    pass=$((pass+1))
  else
    echo "FAIL: ACCESS=full did not permit $name"; fail=$((fail+1))
  fi
done

# Even at full: configure stays denied, because it grants no capability and its
# only effect is printing a shared live credential into one person's transcript.
# The dashboard tools stay denied too - they are not in the pinned build, and if
# the pin ever moves they must not become reachable by a data grant.
for name in clevertap_configure clevertap_web_login clevertap_web_request \
            clevertap_send_test_push clevertap_get_campaigns_ui; do
  out="$(printf '{"tool_name":"mcp__clevertap__%s"}' "$name" \
    | env INSURWRECK_CLEVERTAP_ACCESS=full bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: ACCESS=full permitted $name, which it must never"; fail=$((fail+1))
  fi
done

# Only the two documented levels count. A typo, a guess, or the old flag name
# must grant nothing rather than falling through to something permissive.
for val in 1 true yes FULL Campaign admin ""; do
  out="$(printf '{"tool_name":"mcp__clevertap__clevertap_create_campaign"}' \
    | env INSURWRECK_CLEVERTAP_ACCESS="$val" bash "$HOOK")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    pass=$((pass+1))
  else
    echo "FAIL: ACCESS='$val' was treated as a grant"; fail=$((fail+1))
  fi
done

# The superseded flag name must be inert, so a stale settings.json from the
# previous shape does not silently keep granting anything.
out="$(printf '{"tool_name":"mcp__clevertap__clevertap_create_campaign"}' \
  | env INSURWRECK_CLEVERTAP_CAMPAIGN_TOOLS=1 bash "$HOOK")"
if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
  pass=$((pass+1))
else
  echo "FAIL: the superseded CAMPAIGN_TOOLS flag still grants"; fail=$((fail+1))
fi

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
