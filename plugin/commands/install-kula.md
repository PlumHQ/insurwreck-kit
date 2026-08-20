---
description: Fetch the Kula MCP server on this machine (organizer-run, on request)
---

Install the Kula MCP server for someone who needs it.

**Not advertised to participants.** The installer stopped prewarming this package
because Kula is gated to a short email allowlist and ~137 machines were paying for
a download a dozen people would use. This command is how an organizer hands it to
one of those people on the day. Nothing here is secret - a participant who finds it
in `/` autocomplete can run it, and the allowlist check below is what tells them
whether it will do anything.

## Step 1 — Check they can actually use it before installing anything

The package is useless without the key, and the key only appears in a bundle if the
participant is on `KULA_EMAILS` on the desk. Installing first and discovering that
second wastes several minutes and looks like a failed install.

```bash
node -e '
const os=require("os"),fs=require("fs");
const p=os.homedir()+"/.insurwreck/credentials.json";
if(!fs.existsSync(p)){console.log("NO_BUNDLE");process.exit(0)}
const k=(JSON.parse(fs.readFileSync(p,"utf8")).services||{}).kula;
console.log(k&&k.api_key?"HAS_KEY":"NO_KEY");'
```

- **`HAS_KEY`** — go to Step 2.
- **`NO_KEY`** — they are not on the allowlist, or were not when they last
  provisioned. Do NOT install. Tell them Kula is limited to a named group for this
  event. If they *should* have it: an organizer adds their address to `KULA_EMAILS`
  on `insurwreck-desk`, redeploys, then the participant runs `/insurwreck:status`
  and `iw-connect`. Only then is this command worth running.
- **`NO_BUNDLE`** — they have not onboarded. Send them to `/insurwreck:start`.

## Step 2 — Fetch the package

```bash
npx -y @kula-ai/mcp-server --version >/dev/null 2>&1 && echo cached || echo "will download on first use"
```

This fills the npx cache. `--version` exits as soon as the package is fetched, so
a non-zero exit here usually means the package rejected the flag rather than that
the download failed — it is informational, not an error.

Needs node 22 or newer (`@kula-ai/mcp-server` declares `>=22`). If `node --version`
is below that, run `iw-doctor` — it names the fix.

## Step 3 — Tell them what to expect

The server is already declared in the plugin, so there is nothing to configure, and
the key was already in `settings.json` before you ran this - otherwise Step 1 would
have stopped you. So **`/reload-plugins` is enough**; a full quit and restart is not.

Measured, not assumed: the `env` block in `settings.json` is snapshotted when Claude
Code starts, which is why onboarding genuinely needs a restart after `iw-connect`
writes a new key. Nothing about *this* command touches that block - it only fills the
npx cache - so the cheaper reload is the correct instruction. Telling them to restart
when they do not need to is how the instruction that does matter stops being
believed.

Then say the one thing that matters about Kula: **it is read-only, enforced by a
hook, and the data is real.** Real candidates, real applications, real people. Reads
work; anything that writes is denied with an explanation. Nothing goes on a slide or
into Slack.
