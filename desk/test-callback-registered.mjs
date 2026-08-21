// callbackRegistered must agree with itself before it says yes.
//
//   node desk/test-callback-registered.mjs
//
// Why this exists: the caller persists a true into the credentials row, so a
// single lucky probe latches console_registered while some of Google's
// frontends still reject the URI. See the comment above callbackRegistered.

import assert from "node:assert/strict";
import { callbackRegistered } from "./api/_minters.js";

const CLIENT = "test-client.apps.googleusercontent.com";
const URI = "https://ref.supabase.co/auth/v1/callback";

// Each entry is one scripted fetch reply, consumed in order.
function withFetch(replies, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const next = replies.shift();
    if (next === "throw") throw new Error("network down");
    if (next === "accept") return { ok: true, text: async () => "<html>consent screen</html>" };
    if (next === "mismatch") return { ok: true, text: async () => "Error 400: redirect_uri_mismatch" };
    if (next === "http500") return { ok: false, text: async () => "<html>oops</html>" };
    throw new Error(`unscripted reply: ${next}`);
  };
  return run(calls).finally(() => {
    globalThis.fetch = real;
  });
}

let passed = 0;
const fail = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (error) {
    fail.push(`${name}: ${error.message}`);
  }
}

await check("two accepts -> registered", () =>
  withFetch(["accept", "accept"], async () => {
    assert.equal(await callbackRegistered(CLIENT, URI), true);
  })
);

// The regression this file exists for. Pre-change, the first accept won.
await check("accept then mismatch -> NOT registered", () =>
  withFetch(["accept", "mismatch"], async () => {
    assert.equal(await callbackRegistered(CLIENT, URI), false);
  })
);

await check("mismatch first -> short-circuits, second probe never fires", () =>
  withFetch(["mismatch"], async (calls) => {
    assert.equal(await callbackRegistered(CLIENT, URI), false);
    assert.equal(calls.length, 1, `expected 1 probe, got ${calls.length}`);
  })
);

await check("default is exactly 2 probes, not 1 and not 3", () =>
  withFetch(["accept", "accept"], async (calls) => {
    await callbackRegistered(CLIENT, URI);
    assert.equal(calls.length, 2, `expected 2 probes, got ${calls.length}`);
  })
);

await check("confirmations=5 requires all five", () =>
  withFetch(["accept", "accept", "accept", "accept", "mismatch"], async () => {
    assert.equal(await callbackRegistered(CLIENT, URI, 5), false);
  })
);

await check("confirmations=5 all accepting -> registered", () =>
  withFetch(["accept", "accept", "accept", "accept", "accept"], async (calls) => {
    assert.equal(await callbackRegistered(CLIENT, URI, 5), true);
    assert.equal(calls.length, 5);
  })
);

// Fail closed on anything that is not a clear accept.
await check("a thrown request is not an accept", () =>
  withFetch(["accept", "throw"], async () => {
    assert.equal(await callbackRegistered(CLIENT, URI), false);
  })
);

await check("non-2xx is not an accept", () =>
  withFetch(["accept", "http500"], async () => {
    assert.equal(await callbackRegistered(CLIENT, URI), false);
  })
);

// confirmations=0 must not mean "believe it without asking" - that would turn a
// stray 0 from a caller into an unconditional true.
await check("confirmations=0 still probes once", () =>
  withFetch(["mismatch"], async (calls) => {
    assert.equal(await callbackRegistered(CLIENT, URI, 0), false);
    assert.equal(calls.length, 1);
  })
);

await check("the probed URI reaches Google url-encoded", () =>
  withFetch(["accept", "accept"], async (calls) => {
    await callbackRegistered(CLIENT, URI);
    assert.ok(calls.length > 0, "no probe was made");
    assert.ok(calls[0].includes(encodeURIComponent(URI)), "redirect_uri not encoded in probe URL");
    assert.ok(calls[0].includes(encodeURIComponent(CLIENT)), "client_id not encoded in probe URL");
  })
);

console.log(
  fail.length
    ? `callback-registered: FAIL ${fail.length}\n  ${fail.join("\n  ")}`
    : `callback-registered: ${passed} passed, 0 failed`
);
process.exit(fail.length ? 1 : 0);
