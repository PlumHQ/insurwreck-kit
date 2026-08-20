---
description: Fetch the CleverTap MCP server on this machine (organizer-run, on request)
---

Install the CleverTap MCP server for someone who needs it.

**Not advertised to participants.** The installer stopped prewarming this package
because CleverTap is gated to a short email allowlist. This command is how an
organizer hands it to one of those people on the day. Nothing here is secret - a
participant who finds it in `/` autocomplete can run it, and the check below is what
tells them whether it will do anything.

## Step 1 — Check they can actually use it before installing anything

CleverTap needs three values, and all three only appear in a bundle if the
participant is on `CLEVERTAP_EMAILS` on the desk.

```bash
node -e '
const os=require("os"),fs=require("fs");
const p=os.homedir()+"/.insurwreck/credentials.json";
if(!fs.existsSync(p)){console.log("NO_BUNDLE");process.exit(0)}
const c=(JSON.parse(fs.readFileSync(p,"utf8")).services||{}).clevertap||{};
console.log(c.account_id&&c.passcode&&c.region?"HAS_CREDS":"NO_CREDS");'
```

- **`HAS_CREDS`** — go to Step 2.
- **`NO_CREDS`** — they are not on the allowlist, or were not when they last
  provisioned. Do NOT install. If they *should* have it: an organizer adds their
  address to `CLEVERTAP_EMAILS` on `insurwreck-desk`, redeploys, then the
  participant runs `/insurwreck:status` and `iw-connect`.
- **`NO_BUNDLE`** — they have not onboarded. Send them to `/insurwreck:start`.

## Step 2 — Fetch the package

**Pin the version. Do not drop the `@1.0.0`.**

```bash
npx -y clevertap-mcp@1.0.0 --version >/dev/null 2>&1; echo "fetched (exit $? is expected - it rejects --version)"
```

The pin is load-bearing and matches `plugin/.mcp.json`. The published 1.0.0 build
has the browser/dashboard tools commented out, so it registers 28 REST tools and
nothing else. A later release could uncomment them, and `clevertap_send_test_push`
delivers a real push notification to a real device. The write-block hook denies
those tools anyway, but the pin is what keeps them from being registered at all.

## Step 3 — Tell them what to expect

The server is already declared in the plugin. If CleverTap showed as failed in this
session it will connect after a restart.

Then say the two things that matter:

- **It is read-only, enforced, with no override.** Allowed: `clevertap_get_*`,
  `clevertap_list_projects`, `clevertap_poll`. Everything else is denied, including
  `clevertap_request`, which is blocked by name because it takes an arbitrary path
  and method.
- **The account is production.** `clevertap_create_campaign` would send real push,
  email or SMS to real Plum members with no recall - which is exactly why it is
  blocked. Read the analytics freely; model any campaign in their own Supabase and
  demo that.
