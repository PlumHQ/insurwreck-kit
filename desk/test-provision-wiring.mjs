// Guards the wiring that has now silently broken twice: a service can be
// dropped from provision.js by a merge and nothing complains, because the mint
// loop iterates MINTERS while `pending` is computed from SERVICES. Drift between
// the two makes a service vanish from every bundle with no error anywhere -
// which is what happened to kula, and how a participant's MCP server ended up
// sending an empty token and getting 401 err_token_invalid.
//
// Also checks every declared minter actually exists in _minters.js, so an
// orphaned export or a bad import name fails here rather than at 9am.
//
// Run: node desk/test-provision-wiring.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "api/provision.js"), "utf8");

const services = [
  ...src.matchAll(/const SERVICES = \[([\s\S]*?)\]/g),
]
  .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));

const minters = [
  ...(src.match(/const MINTERS = \{([\s\S]*?)\n\};/) || ["", ""])[1].matchAll(
    /^\s*([a-z_0-9]+)\s*:\s*(\w+)/gm
  ),
].map((m) => ({ service: m[1], fn: m[2] }));

test("SERVICES is non-empty and includes every service we mint", () => {
  assert.ok(services.length >= 7, `parsed only ${services.length} services`);
  for (const { service } of minters) {
    assert.ok(
      services.includes(service),
      `"${service}" has a minter but is missing from SERVICES - it would never appear in a bundle and never show as pending`
    );
  }
});

test("every service in SERVICES has a minter", () => {
  const wired = new Set(minters.map((m) => m.service));
  for (const service of services) {
    assert.ok(wired.has(service), `"${service}" is in SERVICES but has no minter`);
  }
});

test("kula specifically is wired", () => {
  // Named explicitly because this is the one that was reverted, twice.
  assert.ok(services.includes("kula"), "kula missing from SERVICES");
  assert.ok(
    minters.some((m) => m.service === "kula"),
    "kula missing from MINTERS"
  );
});

test("every minter named in provision.js is exported by _minters.js", async () => {
  const mod = await import("./api/_minters.js");
  for (const { service, fn } of minters) {
    assert.equal(typeof mod[fn], "function", `${fn} (for ${service}) is not exported by _minters.js`);
  }
});

test("helpers used from _lib.js are imported", () => {
  const imported = (src.match(/import \{([^}]*)\} from "\.\/_lib\.js"/) || ["", ""])[1];
  for (const fn of ["isAdmin", "normalizeEmail", "sb", "readBody", "nowIso", "sha256"]) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(src)) {
      assert.ok(imported.includes(fn), `${fn} is used but not imported from _lib.js`);
    }
  }
});
