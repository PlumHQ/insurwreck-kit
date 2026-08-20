// The rule that turns what a participant types into their public hostname.
//
//   node desk/api/site-name.test.mjs
//
// This string ends up on a slide and gets read out loud, so two naive-slugify
// failures are pinned here. Both were real:
//   - an idea called "déjà" slugified to "d-j" when non-ascii was deleted
//     instead of folded
//   - a hard character cap cut mid-word: "insurwreck-the-collective-brai"
//
// Also pinned: it must never fall back to the email local part. That is the
// person, not the project, and naming the URL after the person is what this
// replaced.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { slugHost } from "./_minters.js";

const here = dirname(fileURLToPath(import.meta.url));

for (const [input, want] of [
  ["claims-copilot",                                  "claims-copilot"],
  ["Claims Copilot",                                  "claims-copilot"],
  ["déjà",                                            "deja"],
  ["INSURWRECK — THE COLLECTIVE BRAIN",                "insurwreck-the-collective"],
  ["Omni — Ask anything. Then practise it for real",   "omni-ask-anything-then"],
  ["  --Spaces and dashes--  ",                        "spaces-and-dashes"],
  ["", ""],
  [null, ""],
  [undefined, ""],
]) {
  assert.equal(slugHost(input), want, `slugHost(${JSON.stringify(input)})`);
}

// A hostname label is capped at 63 octets by DNS; ours is far shorter, but the
// cap must hold for any input length.
assert.ok(slugHost("a".repeat(200)).length <= 30, "must stay within the cap");
assert.ok(!slugHost("word ".repeat(40)).endsWith("-"), "must not end on a hyphen");

// The fallback chain must not include the email local part.
const minters = readFileSync(join(here, "_minters.js"), "utf8");
const block = minters.slice(minters.indexOf("const candidates = ["));
// To the closing `];` of the array, not the first `]` - that one belongs to the
// inner [`${chosen}...`] and slicing there silently tests an empty string.
const candidates = block.slice(0, block.indexOf("];") + 2);
assert.ok(!/email\.split/.test(candidates),
  "the host must never fall back to the email local part - that names the person");
assert.match(candidates, /payload\.project_name/,
  "the last resort must be the unique project slug");

// The lookup needs sb(), and this file has shipped a missing-import bug before.
assert.match(minters, /import \{[^}]*\bsb\b[^}]*\} from "\.\/_lib\.js"/,
  "_minters.js must import sb - it calls it for the site_name lookup");

console.log("ok - site name folds accents, cuts on words, never names the person");
