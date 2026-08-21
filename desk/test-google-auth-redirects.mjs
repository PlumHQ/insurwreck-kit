// The redirect allow list is the half of Google sign-in that fails at the demo:
// the provider can be perfectly configured, and a URL missing from this list
// still bounces the return trip on the machine projecting the slide. Plum
// Compass hit exactly that - configured before their insurwreck.com domain
// minted, allow list carrying only localhost and vercel.app.
//
// So what is asserted here is list construction and the top-up path: a fresh
// mint carries the insurwreck.com domain, an already-configured team picks it
// up on the next repair, and the merge never drops an entry a team added by
// hand in their own dashboard.
//
// Run: node desk/test-google-auth-redirects.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.SUPABASE_MGMT_TOKEN = "test-mgmt-token";

const { mintGoogleAuth, googleAllowList } = await import("./api/_minters.js");

const CONTEXT = {
  supabase: { project_ref: "testref" },
  vercel: {
    project_name: "iw-plum-compass-9d07",
    app_url: "https://iw-plum-compass-9d07.insurwreck.com",
  },
};
const APP_ENTRY = "https://iw-plum-compass-9d07.insurwreck.com/**";

// Answers by URL shape and records every config/auth call, so each test can
// assert not just what was written but whether anything was written at all.
function stubFetch({ liveAllowList = "" } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    if (url.includes("accounts.google.com")) {
      return { ok: true, text: async () => "" };
    }
    if (url.includes("/config/auth")) {
      calls.push({ method, body: options.body ? JSON.parse(options.body) : null });
      if (method === "GET") {
        return { ok: true, json: async () => ({ uri_allow_list: liveAllowList }) };
      }
      return { ok: true, text: async () => "" };
    }
    if (url.includes("/database/query")) {
      return { ok: true, text: async () => "" };
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  };
  return calls;
}

test("a fresh mint allows the insurwreck.com domain and demos from it", async () => {
  const calls = stubFetch();
  const payload = await mintGoogleAuth("pallavi.r@plumhq.com", {}, CONTEXT);

  const configure = calls.find((c) => c.method === "PATCH");
  assert.ok(configure, "expected the auth config to be written");
  assert.match(configure.body.uri_allow_list, /iw-plum-compass-9d07\.insurwreck\.com\/\*\*/);
  // The URL on the slide is the one Supabase should fall back to.
  assert.equal(configure.body.site_url, "https://iw-plum-compass-9d07.insurwreck.com");
  assert.ok(payload.redirect_allow_list.includes(APP_ENTRY));
});

test("a team configured before their domain minted is topped up on repair", async () => {
  const handAdded = "https://something-they-added.example.com/**";
  const stale = [
    "http://localhost:3000/**",
    "http://localhost:5173/**",
    "https://iw-plum-compass-9d07*.vercel.app/**",
  ];
  const calls = stubFetch({ liveAllowList: [...stale, handAdded].join(",") });
  const payload = await mintGoogleAuth(
    "pallavi.r@plumhq.com",
    { configured: true, console_registered: true, redirect_allow_list: stale },
    CONTEXT
  );

  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch, "expected a top-up write");
  const written = patch.body.uri_allow_list.split(",");
  assert.ok(written.includes(APP_ENTRY), "the missing domain entry is added");
  // The merge is against the LIVE config, not our stored copy - an entry the
  // team pasted into their own dashboard survives the top-up.
  assert.ok(written.includes(handAdded), "hand-added entries are never dropped");
  assert.ok(payload.redirect_allow_list.includes(APP_ENTRY));
  assert.ok(payload.redirect_allow_list.includes(handAdded));
});

test("a complete team is left alone - no reads, no writes", async () => {
  const calls = stubFetch();
  await mintGoogleAuth(
    "pallavi.r@plumhq.com",
    {
      configured: true,
      console_registered: true,
      redirect_allow_list: googleAllowList(CONTEXT),
    },
    CONTEXT
  );
  assert.equal(calls.length, 0, "an up-to-date allow list must cost zero config calls");
});

test("no domain assigned yet means the old list, and vercel.app as site_url", async () => {
  const noDomain = { supabase: { project_ref: "testref" }, vercel: { project_name: "iw-solo-1a2b" } };
  const calls = stubFetch();
  const payload = await mintGoogleAuth("solo@plumhq.com", {}, noDomain);

  const configure = calls.find((c) => c.method === "PATCH");
  assert.equal(configure.body.site_url, "https://iw-solo-1a2b.vercel.app");
  assert.doesNotMatch(configure.body.uri_allow_list, /insurwreck\.com/);
  // And once INSURWRECK_APP_DOMAIN assigns them a domain later, the top-up
  // above is what closes the gap - asserted by the repair test, driven by the
  // same list builder, so the two paths cannot disagree.
  assert.equal(payload.redirect_allow_list.length, 3);
});
