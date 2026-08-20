// node desk/api/claims-api.test.mjs
//
// The client half: paging, the filter allowlist, and section mapping. It earns a
// check because all three fail silently rather than loudly. Upstream declares
// pageSize as `max_value=10, default=50` and DRF does not validate defaults, so
// sending the field at all turns a working call into a 400; and its `_links.next`
// is `current_count >= limit`, a might-be-more hint, so a full last page still
// advertises a next that lands on an empty one. Either mistake returns rows - just
// not all of them - which is the kind of wrong nobody notices.
import assert from "node:assert";

process.env.CLAIMS_MASK_SALT = "test-salt-not-a-real-one";
process.env.PLUM_API_BASE = "https://api.example.invalid";
process.env.PLUM_API_TOKEN = "test-token";
const { listClaims, getClaim, guardRead } = await import("./_claims.js");

let checks = 0;
const check = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, label);
  checks += 1;
};
const ok = (label, condition) => {
  assert.ok(condition, label);
  checks += 1;
};
const rejects = async (label, run, why) => {
  await assert.rejects(run, new RegExp(why, "i"), label);
  checks += 1;
};

let calls = [];
let headersSeen = [];
let methodsSeen = [];
const serve = (handler) => {
  calls = [];
  headersSeen = [];
  methodsSeen = [];
  globalThis.fetch = async (url, init) => {
    headersSeen.push(init?.headers || {});
    methodsSeen.push(init?.method);
    calls.push(new URL(url));
    const { status = 200, body } = handler(calls[calls.length - 1], calls.length);
    return { ok: status < 400, status, text: async () => JSON.stringify(body ?? null) };
  };
};

const claim = (n) => ({ plumClaimId: `CL${n}`, memberName: "Rajesh Kumar", memberId: "mem_1" });
const page = (rows, next) => ({ _links: { next, prev: null }, results: rows, size: rows.length });

// Pages until next is null, and concatenates.
serve((url) => {
  const n = Number(url.searchParams.get("page"));
  if (n === 1) return { body: page([claim(1), claim(2)], "…page=2") };
  if (n === 2) return { body: page([claim(3)], null) };
  throw new Error("asked for a page it should not have");
});
let result = await listClaims({ memberId: "mem_1" }, { email: "a@plumhq.com" });
check("every page is collected", result.row_count, 3);
check("and it stops when next is null", result.pages_fetched, 2);
check("filters reach the query string", calls[0].searchParams.get("memberId"), "mem_1");
ok("pageSize is never sent", calls.every((u) => !u.searchParams.has("pageSize")));
check("the path is the list endpoint", calls[0].pathname, "/claims/");

// A full last page advertises a next that lands on nothing. Stop there.
serve((url) => {
  const n = Number(url.searchParams.get("page"));
  if (n === 1) return { body: page([claim(1)], "…page=2") };
  return { body: page([], "…page=3") };
});
result = await listClaims({}, {});
check("an empty page ends it, whatever next claims", result.row_count, 1);
check("and the empty page is the last request", calls.length, 2);

// Rows come back masked, and say so.
serve(() => ({ body: page([claim(1)], null) }));
result = await listClaims({}, { email: "a@plumhq.com" });
ok("names are masked in list output", /^Member [0-9a-f]{8}$/.test(result.claims[0].memberName));
check("memberId is left alone - it is the filter key", result.claims[0].memberId, "mem_1");
check("the response says what was masked", result.masked, "names, phone numbers and email addresses");

// A filter DRF would silently drop is refused instead.
await rejects(
  "an unknown filter is refused, not ignored",
  () => listClaims({ hospitalName: "Manipal" }, {}),
  'unknown filter "hospitalName"'
);

// Detail: default sections, and only those.
serve(() => ({ body: claim(7005) }));
result = await getClaim("CL7005", null, { email: "a@plumhq.com" });
check("the claim id is in the path", calls[0].pathname, "/claims/CL7005/");
check("documents is on by default", calls[0].searchParams.get("returnDocuments"), "true");
check("status content is on by default", calls[0].searchParams.get("returnStatusContent"), "true");
ok(
  "previously-uploaded documents are not",
  !calls[0].searchParams.has("returnPreviouslyUploadedDocuments")
);
check("the sections used are reported back", result.sections, ["documents", "status"]);

// An explicit include replaces the default rather than adding to it.
serve(() => ({ body: claim(7005) }));
await getClaim("CL7005", ["comments"], {});
check("only what was asked for is requested", calls[0].searchParams.get("returnComments"), "true");
ok("and nothing else", !calls[0].searchParams.has("returnDocuments"));

// Bad input fails before a request is made.
await rejects("an unknown section is refused", () => getClaim("CL1", ["everything"], {}), 'unknown section');
await rejects("a missing claim id is refused", () => getClaim("", null, {}), "claim_id is required");

// An upstream failure never relays the upstream body: a DRF validation error
// echoes the query back and a 500 can carry a traceback with real values in it.
serve(() => ({ status: 500, body: { detail: "Rajesh Kumar not found in shard 3" } }));
await rejects("upstream errors are not relayed", () => getClaim("CL1", null, {}), "refused that request \\(500\\)");

// A 401 is almost always the service JWT having expired, and "refused (401)"
// sends someone hunting for a bug that isn't there.
serve(() => ({ status: 401, body: { detail: "Invalid token header." } }));
await rejects("an expired credential says so", () => getClaim("CL1", null, {}), "PLUM_API_TOKEN needs reissuing");

// Unconfigured is said plainly, not left as a stack trace.
process.env.PLUM_API_BASE = "";
await rejects("an unset base URL is named", () => listClaims({}, {}), "PLUM_API_BASE is unset");
process.env.PLUM_API_BASE = "https://api.example.invalid";

// Two credential types upstream, each read from its own header. Picking by shape
// beats making someone match a header to a secret they were handed.
process.env.PLUM_API_TOKEN = "opaque-store-token";
serve(() => ({ body: claim(1) }));
await getClaim("CL1", null, {});
check("an opaque token goes in Access-Token", headersSeen[0]["Access-Token"], "opaque-store-token");
ok("and not in the JWT header", !("X-Plum-Internal-Token" in headersSeen[0]));

process.env.PLUM_API_TOKEN = "aaa.bbb.ccc";
serve(() => ({ body: claim(1) }));
await getClaim("CL1", null, {});
check("a JWT goes in X-Plum-Internal-Token", headersSeen[0]["X-Plum-Internal-Token"], "aaa.bbb.ccc");
ok("and not in the opaque header", !("Access-Token" in headersSeen[0]));
process.env.PLUM_API_TOKEN = "test-token";

// Read-only, asserted at the one place every outbound call passes through. The
// desk's credential is an org-wide service token and the claims viewset accepts
// put, patch, post and delete on the same paths we read from, so a stray method
// argument added later would edit a real member's claim.
check("GET is allowed", guardRead("GET"), "GET");
check("and case doesn't matter", guardRead("get"), "GET");
for (const verb of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "", null, undefined]) {
  assert.throws(() => guardRead(verb), /read-only/i, `guardRead refuses ${verb}`);
  checks += 1;
}

serve(() => ({ body: claim(1) }));
await getClaim("CL1", null, {});
check("every real request goes out as GET", methodsSeen, ["GET"]);

console.log(`claims client: ${checks} cases pass`);
