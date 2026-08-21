#!/usr/bin/env bash
# PreToolUse hook (mcp__clevertap__*): CleverTap is read-only. No writes, no
# exceptions, no override.
#
# This is the strictest of the three shared-credential hooks, because CleverTap
# hands us the least. Its REST API authenticates with an account-level Account ID
# + Passcode pair - no OAuth, no per-user key, and no read-only passcode type -
# so one full-access credential is shared by every participant. There is no
# narrower key to fall back on, which makes this file the ONLY thing standing
# between an agent and a live engagement platform.
#
# What a write actually does here, in descending order of damage:
#
#   clevertap_create_campaign   POST /targets/create.json with when:"now" over
#                               push, email, SMS, webpush, in-app or webhook.
#                               Sends real messages to real Plum members. No
#                               recall, no undo, no draft state.
#   clevertap_request           Arbitrary path + method including DELETE. Its own
#                               tool description advertises `POST /upload` as an
#                               example, so it is a complete bypass of any
#                               per-tool allowlist and is denied outright.
#   clevertap_delete_profile    POST /delete/profiles.json - erases a real member
#                               profile.
#   clevertap_upload_profile    Rewrites live profile attributes that campaign
#   clevertap_upload_events     targeting and analytics are computed from, so a
#                               bad write silently skews everyone else's numbers.
#
# ALLOW-BY-NAME, DENY EVERYTHING ELSE. The allowlist below is exhaustive and
# closed: three patterns, all verified read-only against clevertap-mcp@1.0.0.
# A tool added by a future release is denied on the day it ships rather than the
# day someone notices. Note that CleverTap uses POST for several READS
# (/counts/profiles.json, /counts/trends.json), so an HTTP-method filter would
# not work even if we could see the method from here - the name is the signal.
#
# TWO graded exceptions exist, both delivered per person through the bundle
# (CLEVERTAP_CAMPAIGN_EMAILS and CLEVERTAP_FULL_EMAILS on the desk) rather than
# set by hand, so who holds what is a recorded decision and not a local edit.
#
#   INSURWRECK_CLEVERTAP_ACCESS=campaign
#     Adds exactly clevertap_create_campaign and clevertap_stop_campaign. For an
#     idea that IS campaign automation and cannot be built read-only. Nothing
#     else widens: clevertap_request stays denied, and so do every upload_*,
#     delete_profile, demerge_profile, disassociate_phone and subscribe.
#
#   INSURWRECK_CLEVERTAP_ACCESS=full
#     Adds every write the pinned server registers, including profile deletion,
#     consent changes via subscribe, and clevertap_request with its arbitrary
#     path and method. Granted by name, to one person, knowingly.
#
# clevertap_configure stays denied at BOTH levels, and that is not an oversight.
# It grants no capability - the credentials are already wired into the server -
# and its only effect is printing the shared Account ID and passcode back as
# text, putting a live credential that belongs to everyone on the key into one
# person's transcript. "Full access to the data" and "leak the shared secret"
# are different things.
#
# Understand what these send before adding anyone: create_campaign posts
# /targets/create.json and with when:"now" delivers push, email or SMS to real
# members immediately - no draft, no recall. The API has NO save-as-draft; that
# exists only in the dashboard UI, whose tools this build does not register.
#
# Fail-open on error by design: only the explicit JSON "deny" below blocks, and
# any internal failure falls through to exit 0. A broken hook must not stop
# someone's build day. The cost of that choice is bounded because the server is
# pinned to clevertap-mcp@1.0.0 in plugin/.mcp.json, whose published build has
# the browser/dashboard tools commented out - so no login, session-replay, or
# test-push tool is registered at all. The web_* denials below exist for the case
# where that pin moves or someone builds from the repo's main branch.

raw="$(cat)"

tool="$(printf '%s' "$raw" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    let j={}; try { j = JSON.parse(d); } catch (e) {}
    process.stdout.write(String(j.tool_name || ''));
  });" 2>/dev/null)"

[ -n "$tool" ] || exit 0

deny() {
  node -e '
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: process.argv[1]
      }
    }));
  ' "$1" 2>/dev/null
  exit 0
}

# Strip the mcp__clevertap__ prefix. Tool names are themselves prefixed with
# clevertap_, so mcp__clevertap__clevertap_get_profile arrives as
# clevertap_get_profile.
name="${tool##*__}"

# Dashboard/browser tools are denied FIRST, before the read allowlist runs.
# clevertap_get_campaigns_ui reads as a get_* by shape but is a session-replay
# tool, so an allowlist-first ordering would let it through - which is exactly
# what test-block-clevertap-writes.sh caught when this block sat lower down.
case "$name" in
  clevertap_web_*|clevertap_send_test_push|clevertap_get_campaigns_ui)
    deny "The CleverTap dashboard/browser tools are not part of this event. They drive a real Chromium login and then replay authenticated dashboard API calls - clevertap_send_test_push delivers an actual push notification to a real device. The pinned server (clevertap-mcp@1.0.0) does not register them; seeing this means something is running an unpinned or locally-built copy, so tell an organiser." ;;
esac

# The exhaustive read allowlist. Everything else falls through to a deny.
#   clevertap_get_*         every typed read: profiles, events, campaigns,
#                           reports, DAU, trends, uninstalls, real-time counts
#   clevertap_list_projects names + account IDs of configured projects; the
#                           passcode is never in that output
#   clevertap_poll          GET /{path}?req_id={id} only - collects the result of
#                           an async read that already happened
case "$name" in
  clevertap_get_*|clevertap_list_projects|clevertap_poll)
    exit 0 ;;
esac

# The graded grants. Checked after the dashboard denials and after the read
# allowlist, so neither can reach a dashboard tool even if the version pin moves.
case "${INSURWRECK_CLEVERTAP_ACCESS:-}" in
  campaign)
    case "$name" in
      clevertap_create_campaign|clevertap_stop_campaign) exit 0 ;;
    esac
    ;;
  full)
    # Everything except configure - see the note at the top of this file.
    case "$name" in
      clevertap_configure) ;;
      *) exit 0 ;;
    esac
    ;;
esac

# Specific reasons for the tools an agent will actually reach for, so the block
# teaches instead of just refusing.
case "$name" in
  clevertap_create_campaign)
    deny "CleverTap is read-only for this event, and this is the tool that reason exists for: it creates AND launches a real campaign, sending push, email or SMS to real Plum members with no recall. The CleverTap passcode is shared by every participant. Read the engagement data with clevertap_get_campaigns, clevertap_get_campaign_report and clevertap_get_message_report, then model your campaign in your own Supabase and show that in the demo." ;;
  clevertap_stop_campaign)
    deny "CleverTap is read-only for this event. Stopping a campaign is still a write to a live engagement account, and this one halts a send that Plum's growth team is running. If a campaign genuinely needs stopping, an organiser or the campaign owner does it in the CleverTap dashboard - not an agent holding a shared passcode." ;;
  clevertap_request)
    deny "clevertap_request is blocked outright, not filtered. It takes an arbitrary API path and method - including DELETE - so it can perform any write the typed tools are blocked from doing; its own documentation offers 'POST /upload' as an example. The typed read tools cover the useful surface: clevertap_get_profile, clevertap_get_events, clevertap_get_event_trend, clevertap_get_dau, clevertap_get_real_time_counts, clevertap_get_top_property_count." ;;
  clevertap_delete_profile|clevertap_demerge_profile|clevertap_disassociate_phone)
    deny "CleverTap is read-only for this event. This destroys or splits a real member's profile in a live system that campaign targeting and analytics are computed from, and the passcode is shared by all participants. Read the profile with clevertap_get_profile and model the change in your own Supabase." ;;
  clevertap_upload_profile|clevertap_upload_events|clevertap_upload_device_token)
    deny "CleverTap is read-only for this event. Uploading profiles, events or device tokens writes into live member records - it skews the analytics everyone else is reading, and a device token makes that member reachable by push. Persist anything you generate in your own Supabase and read the real data alongside it." ;;
  clevertap_subscribe)
    deny "CleverTap is read-only for this event. This changes a real person's communication subscription state - a consent record. Nobody at this hackathon should be flipping consent flags on live member data. Read the current state with clevertap_get_profile instead." ;;
  clevertap_configure)
    deny "clevertap_configure is blocked. It echoes the Account ID and passcode back as text, which puts a shared live credential into the transcript, and it cannot help anyway: the credentials are already wired into the server by /insurwreck:start. Run clevertap_list_projects to see which project you are pointed at." ;;
esac

deny "CleverTap is read-only for this event, and \"$name\" is not one of its read tools (clevertap_get_*, clevertap_list_projects, clevertap_poll). The Account ID and passcode are shared by every participant and CleverTap offers no read-only credential, so this hook is the only thing preventing writes to a live engagement platform - which is why it has no override. If you need to persist something, write it to your own Supabase."
