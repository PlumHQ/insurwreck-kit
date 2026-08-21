// Does hooks.json actually ROUTE to the write-block scripts?
//
//   node plugin/hooks/scripts/test-hook-matchers.mjs
//
// The three test-block-*.sh suites pipe JSON straight into the scripts, so they
// prove the logic and say nothing about the wiring. On 21 Aug 2026 a participant
// wrote a profile into live CleverTap because the matcher was "mcp__clevertap__.*"
// while a plugin-provided server actually registers its tools as
// "mcp__plugin_insurwreck_clevertap__clevertap_upload_profile" - no match, so the
// hook was never invoked. It looked fine in testing because a server declared
// outside the plugin (a personal .mcp.json) DOES produce mcp__clevertap__*.
//
// This file is the check that was missing: the matcher must catch both shapes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const hooks = JSON.parse(readFileSync(join(HERE, "..", "hooks.json"), "utf8"));

// Both naming shapes Claude Code emits for the same server: plugin-provided
// (namespaced with the plugin name) and locally declared (bare).
const GUARDED = [
  { server: "clevertap", tool: "clevertap_upload_profile", script: "block-clevertap-writes.sh" },
  { server: "kula", tool: "create_candidate", script: "block-kula-writes.sh" },
  { server: "zendesk", tool: "zendesk_create_ticket", script: "block-zendesk-writes.sh" },
];

let passed = 0;
const fail = [];

for (const { server, tool, script } of GUARDED) {
  const entry = hooks.hooks.PreToolUse.find((h) =>
    h.hooks.some((x) => String(x.command).endsWith(script))
  );
  assert.ok(entry, `no PreToolUse entry runs ${script}`);
  const re = new RegExp(entry.matcher);

  for (const name of [
    `mcp__plugin_insurwreck_${server}__${tool}`,
    `mcp__${server}__${tool}`,
  ]) {
    if (re.test(name)) passed++;
    else fail.push(`${script}: matcher ${entry.matcher} does not match ${name}`);

    // The scripts derive the bare tool name with ${tool##*__}. If that ever
    // stops yielding the name the case statements are written against, every
    // allowlist entry silently misses and the hook over-denies instead.
    const bare = name.slice(name.lastIndexOf("__") + 2);
    if (bare === tool) passed++;
    else fail.push(`${script}: prefix strip of ${name} gave "${bare}", expected "${tool}"`);
  }

  // A matcher so loose it catches unrelated servers would default-deny them.
  if (!re.test("mcp__plugin_insurwreck_n8n__list_workflows")) passed++;
  else fail.push(`${script}: matcher ${entry.matcher} also catches n8n tools`);
}

console.log(fail.length ? `FAIL ${fail.length}\n  ${fail.join("\n  ")}` : `ok ${passed} assertions`);
process.exit(fail.length ? 1 : 0);
