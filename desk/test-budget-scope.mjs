// The budget query is the only thing standing between a shared Anthropic key and
// an uncapped bill, and its failure mode is silent: the wrong filter still
// returns a number, the proxy still works, and the overspend only shows up on
// the invoice. So the filter itself is asserted rather than the arithmetic.
//
// This tests the PostgREST filter construction, which is where the bug would be.
// The sums are trivial; the scoping is not.
//
// Run: node desk/test-budget-scope.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Mirrors spentSoFar / entitledToOpenAI in api/llm/[...path].js. Kept as a local
// copy because that module fires network calls at import time; if these two ever
// disagree, the assertion below about `idea_id is null` is the one that matters.
function spendScope(email, ideaId) {
  return ideaId
    ? `idea_id=eq.${ideaId}`
    : `participant_email=eq.${encodeURIComponent(email)}&idea_id=is.null`;
}

const IDEA = "5ec0249c-2439-47f1-8f5f-c2a55508a2e5";

test("a team sums by idea, never by the credential holder", () => {
  const scope = spendScope("arsh.g@plumhq.com", IDEA);
  assert.equal(scope, `idea_id=eq.${IDEA}`);
  // The whole point: three teammates on one key must share one pool. If the
  // email appeared here, each of them would get the full allowance.
  assert.doesNotMatch(scope, /participant_email/);
});

test("a solo bundle sums by email AND excludes idea-keyed rows", () => {
  const scope = spendScope("rohit.mudili@plumhq.com", null);
  assert.match(scope, /participant_email=eq\./);
  // Without `idea_id=is.null`, an organizer who happens to be the credential
  // holder on a team row would have that team's spend counted against their own
  // personal budget.
  assert.match(scope, /idea_id=is\.null/);
});

test("the email is url-encoded, so a + address cannot break the filter", () => {
  // harish.n+test@plumhq.com exists in the 4.0 cohort. Unencoded, the + is a
  // space in a query string and the filter silently matches nothing - which
  // reads as "spent nothing" and hands them an unlimited budget.
  const scope = spendScope("harish.n+test@plumhq.com", null);
  assert.match(scope, /%2B/);
  assert.doesNotMatch(scope, /\+/);
});

test("an empty-string idea is treated as solo, not as a team", () => {
  // row.idea_id is normalised with `|| null`, but if an empty string ever got
  // through, `idea_id=eq.` would match nothing and grant an unlimited budget.
  assert.match(spendScope("a@plumhq.com", ""), /participant_email/);
});

test("summing tolerates null and missing costs", () => {
  const sum = (rows) => rows.reduce((t, r) => t + Number(r.cost_usd || 0), 0);
  assert.equal(sum([{ cost_usd: null }, { cost_usd: "1.25" }, {}]), 1.25);
  assert.equal(sum([]), 0, "no rows must be zero spent, not NaN");
  assert.equal(sum([{ cost_usd: 0.5 }, { cost_usd: 0.5 }]), 1);
});

test("a non-numeric cost would disable the cap, and only the column type stops it", () => {
  const sum = (rows) => rows.reduce((t, r) => t + Number(r.cost_usd || 0), 0);
  // Documenting a real dependency rather than asserting a guard that does not
  // exist: `|| 0` catches null and undefined but not a non-numeric string, so
  // the sum becomes NaN - and `NaN >= budget` is FALSE, which means the cap
  // silently stops applying rather than failing closed.
  const poisoned = sum([{ cost_usd: "not-a-number" }]);
  assert.ok(Number.isNaN(poisoned), "Number('not-a-number') is NaN, as expected");
  assert.equal(poisoned >= 15, false, "a NaN spend passes the budget check");
  // What actually protects us is llm_usage.cost_usd being `numeric` in Postgres,
  // so PostgREST can never hand back a non-numeric value here. If that column
  // type ever changes, this is the test that should start looking alarming.
});

test("the over-budget message tells a member it is the team's pool", () => {
  // A member who has personally spent nothing can hit this. "You've used your
  // budget" would read as a bug to them rather than as their teammates working.
  const msg = (budget, spent, ideaId) =>
    ideaId
      ? `Your team has used its $${budget.toFixed(2)} of model budget for the hackathon ($${spent.toFixed(2)} spent across everyone on the idea - it is one shared pool, not one each). Ask an organizer to raise it.`
      : `You've used your $${budget.toFixed(2)} of model budget for the hackathon ($${spent.toFixed(2)} spent). Ask an organizer to raise it.`;

  const team = msg(15, 15.4, IDEA);
  assert.match(team, /Your team/);
  assert.match(team, /one shared pool, not one each/);
  assert.doesNotMatch(team, /used your/);

  const solo = msg(15, 15.4, null);
  assert.match(solo, /used your/);
  assert.doesNotMatch(solo, /team/);
});
