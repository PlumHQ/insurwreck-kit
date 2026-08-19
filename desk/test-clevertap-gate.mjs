// The CleverTap email gate is the only thing deciding who holds a production
// engagement passcode, and its safe state is the empty one. A regression that
// flips default-deny to default-allow would look like nothing at all in review,
// so it gets asserted rather than trusted.
//
// Run: node desk/test-clevertap-gate.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { clevertapAllowed, mintClevertap } = await import("./api/_minters.js");

// `await run()`, not `return run()`. Returning the promise restores the
// environment the moment the callback hands one back, so an async body would run
// with the env already torn down - which made the blocked-email assertion below
// pass for the wrong reason (empty list denies everyone) while the allowed-email
// assertion failed.
async function withEnv(vars, run) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("unset CLEVERTAP_EMAILS allows nobody", async () => {
  await withEnv({ CLEVERTAP_EMAILS: undefined }, () => {
    assert.equal(clevertapAllowed("rohit.mudili@plumhq.com"), false);
    assert.equal(clevertapAllowed(""), false);
  });
});

test("empty and whitespace-only lists allow nobody", async () => {
  for (const value of ["", "   ", ",", " , , "]) {
    await withEnv({ CLEVERTAP_EMAILS: value }, () => {
      assert.equal(clevertapAllowed("rohit.mudili@plumhq.com"), false, `value: "${value}"`);
    });
  }
});

test("a listed email is allowed, an unlisted one is not", async () => {
  await withEnv({ CLEVERTAP_EMAILS: "a@plumhq.com,b@plumhq.com" }, () => {
    assert.equal(clevertapAllowed("a@plumhq.com"), true);
    assert.equal(clevertapAllowed("b@plumhq.com"), true);
    assert.equal(clevertapAllowed("c@plumhq.com"), false);
  });
});

test("matching ignores case and surrounding whitespace", async () => {
  await withEnv({ CLEVERTAP_EMAILS: " A@PlumHQ.com , b@plumhq.com " }, () => {
    assert.equal(clevertapAllowed("a@plumhq.com"), true);
    assert.equal(clevertapAllowed("A@PLUMHQ.COM"), true);
    assert.equal(clevertapAllowed("  b@plumhq.com  "), true);
  });
});

test("no substring or domain-wide leakage", async () => {
  await withEnv({ CLEVERTAP_EMAILS: "growth@plumhq.com" }, () => {
    // A prefix/suffix of an allowed address must not pass, and listing one
    // person must never imply the domain.
    assert.equal(clevertapAllowed("growth@plumhq.com.attacker.test"), false);
    assert.equal(clevertapAllowed("notgrowth@plumhq.com"), false);
    assert.equal(clevertapAllowed("anyone@plumhq.com"), false);
  });
});

test("mintClevertap refuses an unlisted email even with credentials present", async () => {
  await withEnv(
    {
      CLEVERTAP_EMAILS: "allowed@plumhq.com",
      CLEVERTAP_ACCOUNT_ID: "TEST-XXX-YYY-ZZZZ",
      CLEVERTAP_PASSCODE: "not-a-real-passcode",
      CLEVERTAP_REGION: "in1",
    },
    async () => {
      await assert.rejects(
        () => mintClevertap("blocked@plumhq.com"),
        /not enabled for blocked@plumhq\.com/,
        "an unlisted participant must never receive the passcode"
      );
      // And the allowed one still gets a usable payload, so the gate is not
      // simply breaking the service for everyone.
      const payload = await mintClevertap("allowed@plumhq.com");
      assert.equal(payload.account_id, "TEST-XXX-YYY-ZZZZ");
      assert.equal(payload.region, "in1");
      assert.equal(payload.scoped_to_you, false);
    }
  );
});

test("an allowed email with credentials missing still fails closed", async () => {
  await withEnv(
    {
      CLEVERTAP_EMAILS: "allowed@plumhq.com",
      CLEVERTAP_ACCOUNT_ID: undefined,
      CLEVERTAP_PASSCODE: undefined,
    },
    async () => {
      await assert.rejects(() => mintClevertap("allowed@plumhq.com"), /not both set/);
    }
  );
});
