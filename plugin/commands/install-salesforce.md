---
description: Install the Salesforce CLI and MCP server on this machine (organizer-run, on request)
---

Install Salesforce for someone whose idea actually needs it.

**Not advertised to participants.** The installer stopped doing this because the CLI
is the single largest download in the whole setup - `go.ps1` used to warn it was
"usually 3-6 minutes" - and most participants never complete the browser login it
exists for. This command is how an organizer hands it to someone who does need it.

Unlike Kula and CleverTap there is **no allowlist to check**: Salesforce is scoped by
the participant's own login, so anyone may have it. What they need is time and a
Salesforce account.

## Step 1 — Set expectations before starting

Tell them plainly: this is a large install, typically **3 to 6 minutes**, and npm
prints almost nothing while it works. That silence is normal, not a hang. If they are
mid-build and impatient, this is worth doing while something else runs.

## Step 2 — Install the CLI

`sf` is how the Salesforce MCP server gets a session - it reads orgs the CLI has
already authorised and never handles a password itself. Without the CLI the server
starts and cannot authenticate, which reads as a broken server rather than a missing
dependency.

```bash
if command -v sf >/dev/null 2>&1; then
  echo "already installed: $(sf --version 2>/dev/null | head -1)"
else
  npm i -g @salesforce/cli
fi
```

On Windows, if npm refuses with an ExecutionPolicy error, use `npm.cmd` instead of
`npm` - that exact failure is why the Windows installer calls it that way.

If the install fails, say so and stop. It is not an emergency: everything else they
have still works, and they can retry later.

## Step 3 — Fetch the MCP package

```bash
npx -y @salesforce/mcp --version >/dev/null 2>&1 && echo cached || echo "will download on first use"
```

Then `/reload-plugins` so the Salesforce server picks up the newly installed `sf`.
A full restart is not needed: nothing here changed the `env` block in
`settings.json`, which is the only thing that requires one.

## Step 4 — Hand off to the login, do not attempt it here

Point them at `/insurwreck:connect`, which walks the browser login. Do not try to
authenticate from this command - `sf org login web` opens a real Salesforce page and
belongs in the flow built to explain it.

Two things worth saying while they wait:

- **It acts as them.** Their profile, their permission sets, their sharing rules.
  Anything they cannot see in the Salesforce UI, the agent cannot see either.
- **It is read-only by construction**, not by hook: the server ships with
  `--toolsets data --tools run_soql_query`, and SOQL cannot write. Default to the
  sandbox.
