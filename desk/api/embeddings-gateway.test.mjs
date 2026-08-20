// Guards on the two ways the embeddings path fails silently.
//
//   node desk/api/embeddings-gateway.test.mjs
//
// Both of these were live bugs during development, and neither surfaces as an
// error - they surface as money:
//
//   1. DEFAULT_PRICE is $5/$25 per million. An embedding model that falls
//      through to it is billed at 250x the real rate, so a participant is cut
//      off for spending cents.
//   2. The gateway metered usage.input_tokens only. OpenAI reports
//      prompt_tokens, so every embedding call metered as zero and escaped the
//      budget entirely.
//
// Static assertions on purpose: the constants aren't exported, and adding
// exports just to test them would change shipped code for the test's benefit.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "llm", "[...path].js"), "utf8");

// 1 - embedding models are priced explicitly
for (const [model, rate] of [
  ["text-embedding-3-small", "0.02"],
  ["text-embedding-3-large", "0.13"],
]) {
  const re = new RegExp(`"${model}":\\s*\\{\\s*input:\\s*${rate}\\b`);
  assert.match(src, re, `${model} must be priced at ${rate}/M, not fall through to DEFAULT_PRICE`);
}
assert.match(src, /if \(EMBEDDING_PRICING\[model\]\) return EMBEDDING_PRICING\[model\]/,
  "priceFor must consult EMBEDDING_PRICING before the chat table");

// 2 - metering reads OpenAI's field names too
assert.match(src, /usage\.input_tokens \?\? usage\.prompt_tokens/,
  "metering must fall back to prompt_tokens or embeddings meter as zero");

// 3 - the path restriction is what bounds the key, since the key itself reaches
//     chat completions. Losing this line turns the gateway into an open proxy.
assert.match(src, /upstreamSegments\.join\("\/"\) !== "v1\/embeddings"/,
  "the openai branch must whitelist v1/embeddings only");
assert.match(src, /entitledToOpenAI/, "the openai branch must check entitlement");

// 4 - the catch-all path arrives as a single slash-joined string, not an array.
// Indexing segment 0 without splitting sent every 3-segment request to Anthropic,
// which 404s with an empty body - it reads like a routing bug, not a parsing one.
assert.match(src, /\.flatMap\(\(part\) => String\(part\)\.split\("\/"\)\)/,
  "path segments must be split before segments[0] is compared to 'openai'");

const normalise = (path) =>
  [].concat(path || []).flatMap((p) => String(p).split("/")).filter(Boolean);
for (const shape of ["openai/v1/embeddings", ["openai", "v1", "embeddings"]]) {
  assert.deepEqual(normalise(shape), ["openai", "v1", "embeddings"],
    `both catch-all shapes must normalise the same: ${JSON.stringify(shape)}`);
}
assert.deepEqual(normalise("v1/messages"), ["v1", "messages"], "anthropic path must be unaffected");

console.log("ok - pricing, metering fields, path whitelist, entitlement and segment parsing");
