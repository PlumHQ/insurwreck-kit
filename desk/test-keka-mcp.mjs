// Smallest check that fails if the Keka MCP dispatch breaks. No network, no
// keys: with SUPABASE_* unset, auth fails before any Supabase or Keka call.
// Run: node desk/test-keka-mcp.mjs
import assert from "node:assert/strict";
import test from "node:test";
import handler from "./api/keka-mcp.js";

function mockRes() {
  const captured = { status: null, body: undefined };
  const res = {
    status(code) {
      captured.status = code;
      return res;
    },
    json(payload) {
      captured.body = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  return { res, captured };
}

// The desk resolves tokens against Supabase; stub that fetch so the tests stay
// offline. Returning one row means "this token belongs to a participant".
function stubAuth({ authorized }) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(authorized ? [{ participant_email: "dev@plumhq.com" }] : []),
  });
  return () => {
    globalThis.fetch = original;
  };
}

async function rpc(body, { authorized = true } = {}) {
  const restore = stubAuth({ authorized });
  try {
    const { res, captured } = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer iwk-test" }, body }, res);
    return captured;
  } finally {
    restore();
  }
}

test("GET is a health probe, not an error", async () => {
  const { res, captured } = mockRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.server, "insurwreck-keka");
});

test("an unknown token is rejected before any dispatch", async () => {
  const out = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, { authorized: false });
  assert.equal(out.status, 401);
  assert.equal(out.body.error.code, -32001);
});

test("initialize names the server and warns about the write tool", async () => {
  const out = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize" });
  assert.equal(out.status, 200);
  assert.equal(out.body.result.serverInfo.name, "insurwreck-keka");
  assert.match(out.body.result.instructions, /keka_apply_leave/);
});

test("every tool is namespaced, schema'd and described", async () => {
  const out = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  const { tools } = out.body.result;
  assert.ok(tools.length >= 8, `expected 8+ tools, got ${tools.length}`);
  for (const tool of tools) {
    assert.match(tool.name, /^keka_/);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject stray args`);
    assert.ok(tool.description.length > 10, `${tool.name} needs a real description`);
  }
});

test("notifications get 202 and no body", async () => {
  const out = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(out.status, 202);
  assert.equal(out.body, undefined);
});

test("unknown methods are method-not-found, still HTTP 200", async () => {
  const out = await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(out.status, 200);
  assert.equal(out.body.error.code, -32601);
});

test("an unconfigured desk reports it as a tool error, not a transport error", async () => {
  const out = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "keka_whoami" } });
  assert.equal(out.status, 200, "must stay 200 so the model reads the message");
  assert.equal(out.body.result.isError, true);
  assert.match(out.body.result.content[0].text, /isn't switched on|KEKA_CLIENT_ID/);
});

test("keka_raw_get refuses paths outside the Keka API surface", async () => {
  process.env.KEKA_CLIENT_ID = "test";
  process.env.KEKA_CLIENT_SECRET = "test";
  process.env.KEKA_API_BASE = "https://example.keka.com";
  try {
    for (const path of ["/api/v2/secrets", "/api/v1/../../admin", "https://evil.example/x"]) {
      const out = await rpc({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "keka_raw_get", arguments: { path } },
      });
      assert.equal(out.body.result.isError, true, `${path} should be refused`);
      assert.match(out.body.result.content[0].text, /must start with \/api\/v1\//);
    }
  } finally {
    delete process.env.KEKA_CLIENT_ID;
    delete process.env.KEKA_CLIENT_SECRET;
    delete process.env.KEKA_API_BASE;
  }
});
