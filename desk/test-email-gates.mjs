// Kula and CleverTap are the two services whose credential cannot be scoped at
// the API - no OAuth, no per-user key - so an email allowlist on our side is the
// only control. Both gate live production data: Kula is the real recruiting
// pipeline, CleverTap can send push to real members.
//
// A gate that silently allows is indistinguishable from a gate that works, and
// the safe state is the empty one, so that is what gets asserted hardest.
//
// Run: node desk/test-email-gates.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { emailAllowedFor, kulaAllowed, clevertapAllowed, mintKula, mintClevertap } =
  await import("./api/_minters.js");

// `await run()`, not `return run()`: returning the promise restores the
// environment the moment the callback hands one back, so an async body would run
// with the env already torn down.
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

const GATES = [
  { name: "kula", env: "KULA_EMAILS", fn: (e) => kulaAllowed(e) },
  { name: "clevertap", env: "CLEVERTAP_EMAILS", fn: (e) => clevertapAllowed(e) },
];

for (const gate of GATES) {
  test(`${gate.name}: unset allows nobody`, async () => {
    await withEnv({ [gate.env]: undefined }, () => {
      assert.equal(gate.fn("rohit.mudili@plumhq.com"), false);
      assert.equal(gate.fn(""), false);
      assert.equal(gate.fn(null), false);
    });
  });

  test(`${gate.name}: empty and whitespace-only lists allow nobody`, async () => {
    for (const value of ["", "   ", ",", " , , ", ",,,"]) {
      await withEnv({ [gate.env]: value }, () => {
        assert.equal(gate.fn("rohit.mudili@plumhq.com"), false, `value: "${value}"`);
      });
    }
  });

  test(`${gate.name}: listed in, unlisted out`, async () => {
    await withEnv({ [gate.env]: "a@plumhq.com,b@plumhq.com" }, () => {
      assert.equal(gate.fn("a@plumhq.com"), true);
      assert.equal(gate.fn("b@plumhq.com"), true);
      assert.equal(gate.fn("c@plumhq.com"), false);
    });
  });

  test(`${gate.name}: case and whitespace insensitive`, async () => {
    await withEnv({ [gate.env]: " A@PlumHQ.com , b@plumhq.com " }, () => {
      assert.equal(gate.fn("a@plumhq.com"), true);
      assert.equal(gate.fn("A@PLUMHQ.COM"), true);
      assert.equal(gate.fn("  b@plumhq.com  "), true);
    });
  });

  test(`${gate.name}: no substring or domain-wide leakage`, async () => {
    await withEnv({ [gate.env]: "growth@plumhq.com" }, () => {
      assert.equal(gate.fn("growth@plumhq.com.attacker.test"), false);
      assert.equal(gate.fn("notgrowth@plumhq.com"), false);
      // Listing one person must never imply the domain.
      assert.equal(gate.fn("anyone@plumhq.com"), false);
    });
  });
}

test("the two gates are independent", async () => {
  // The whole reason for one shared helper: a copied second implementation is
  // how one list quietly starts honouring the other's variable.
  await withEnv({ KULA_EMAILS: "k@plumhq.com", CLEVERTAP_EMAILS: "c@plumhq.com" }, () => {
    assert.equal(kulaAllowed("k@plumhq.com"), true);
    assert.equal(kulaAllowed("c@plumhq.com"), false, "kula must not honour the clevertap list");
    assert.equal(clevertapAllowed("c@plumhq.com"), true);
    assert.equal(clevertapAllowed("k@plumhq.com"), false, "clevertap must not honour the kula list");
  });
});

test("an unknown env name allows nobody rather than throwing", async () => {
  // A typo in a future call site must fail closed, not crash the provision or
  // wave everyone through.
  assert.equal(emailAllowedFor("NO_SUCH_VAR", "a@plumhq.com"), false);
});

test("mintKula refuses an unlisted email even with a key present", async () => {
  await withEnv(
    { KULA_EMAILS: "allowed@plumhq.com", KULA_API_KEY: "not-a-real-key" },
    async () => {
      await assert.rejects(
        () => mintKula("blocked@plumhq.com"),
        /kula not enabled for blocked@plumhq\.com/,
        "an unlisted participant must never receive the recruiting-pipeline key"
      );
      const payload = await mintKula("allowed@plumhq.com");
      assert.equal(payload.api_key, "not-a-real-key");
      assert.equal(payload.scoped_to_you, false);
    }
  );
});

test("mintKula on the allowlist still fails closed with no key", async () => {
  await withEnv({ KULA_EMAILS: "allowed@plumhq.com", KULA_API_KEY: undefined }, async () => {
    await assert.rejects(() => mintKula("allowed@plumhq.com"), /KULA_API_KEY not set/);
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
        /clevertap not enabled for blocked@plumhq\.com/
      );
      const payload = await mintClevertap("allowed@plumhq.com");
      assert.equal(payload.account_id, "TEST-XXX-YYY-ZZZZ");
      assert.equal(payload.region, "in1");
    }
  );
});

test("the gate is checked BEFORE the credential is read", async () => {
  // Ordering matters for a reason that is not obvious: if the key check came
  // first, a missing key would mask the gate, and an organizer debugging "why is
  // kula pending" would be told the key is unset when the real answer is that
  // the person is not on the list.
  await withEnv({ KULA_EMAILS: "", KULA_API_KEY: undefined }, async () => {
    await assert.rejects(() => mintKula("anyone@plumhq.com"), /not enabled for/);
  });
});
