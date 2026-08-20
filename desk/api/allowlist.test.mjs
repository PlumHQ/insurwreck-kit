// The allowlist is the only containment boundary for Plum data, so its
// combination rules get a test.
//
//   node desk/api/allowlist.test.mjs
//
// It was a union of MCP_CARD_IDS and the enabled rows, which meant the env seed
// won unconditionally: an organizer pulling a slice back from the console got a
// success response and no change, for exactly the ten cards the seed names. The
// fix subtracts explicit disables rather than dropping the seed, because the
// seed is also the fallback when the table is unreachable - losing it would
// cut everyone off mid-build instead.
//
// Mirrors the rule in mcp.js allowlist(); assert both stay in step.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mcp.js"), "utf8");
assert.match(src, /select=card_id,enabled/,
  "allowlist must read every row, not only the enabled ones");
assert.match(src, /else ids\.delete\(id\)/,
  "a disabled row must subtract from the env seed, or disable is a no-op");

const ENV = [1, 2, 3];
const combine = (rows) => {
  const ids = new Set(ENV);
  for (const r of rows) {
    if (r.enabled) ids.add(r.card_id);
    else ids.delete(r.card_id);
  }
  return [...ids].sort((a, b) => a - b);
};

assert.deepEqual(combine([{ card_id: 2, enabled: false }]), [1, 3],
  "disabling a seeded card must remove it - this is the bug being fixed");
assert.deepEqual(combine([{ card_id: 2, enabled: true }]), [1, 2, 3],
  "an enabled seeded card stays");
assert.deepEqual(combine([{ card_id: 9, enabled: true }]), [1, 2, 3, 9],
  "a DB-only card is added");
assert.deepEqual(combine([{ card_id: 9, enabled: false }]), [1, 2, 3],
  "a DB-only disabled card is never reachable");
assert.deepEqual(combine([]), [1, 2, 3],
  "table unreachable: the env seed must still serve, or an outage closes the event");

console.log("ok - disable subtracts, seed survives an outage, DB-only cards add");
