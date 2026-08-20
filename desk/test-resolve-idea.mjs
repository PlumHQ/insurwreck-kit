// The resolver decides which team's Supabase project 136 people point at, and a
// wrong answer is invisible until someone opens a database with a stranger's
// data in it. Every branch gets a case.
//
// Run: node desk/test-resolve-idea.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIdea,
  mayMint,
  renderPrompt,
  blockedMessage,
} from "./api/_resolve-idea.js";

const m = (idea, role = "member", title = null, published = "2026-08-17") => ({
  idea_id: idea,
  role,
  idea_title: title ?? `idea ${idea}`,
  published_at: published,
});

test("nobody on a published idea gets a solo bundle", () => {
  // Every attending person in this bucket is an organizer. They need tooling.
  assert.deepEqual(resolveIdea([]), { kind: "solo" });
  assert.deepEqual(resolveIdea(null), { kind: "solo" });
  assert.equal(mayMint(resolveIdea([])), true);
});

test("one membership resolves to it, and carries the captain flag", () => {
  assert.deepEqual(resolveIdea([m("a", "owner")]), {
    kind: "resolved",
    ideaId: "a",
    captain: true,
  });
  assert.deepEqual(resolveIdea([m("a", "member")]), {
    kind: "resolved",
    ideaId: "a",
    captain: false,
  });
});

test("captaining exactly one of several STILL asks", () => {
  // Changed deliberately from silently resolving to the captained idea.
  // Guessing points somebody at a teammate's database and looks like nothing
  // is wrong. 8 people are in this bucket on the current roster.
  const r = resolveIdea([m("a"), m("b", "owner"), m("c")]);
  assert.equal(r.kind, "must_ask");
  assert.equal(r.options.length, 3);
  assert.equal(mayMint(r), false, "nothing is minted until they answer");
});

test("the prompt warns a single-captaincy holder what happens if they pick elsewhere", () => {
  const r = resolveIdea([m("a", "member", "OTHER"), m("b", "owner", "MY TEAM")]);
  const text = renderPrompt(r.options);
  assert.match(text, /you're the captain of "MY TEAM"/);
  assert.match(text, /nobody on that team can set it up/);
  assert.match(text, /organizer/);
});

test("the prompt warns a multi-captaincy holder about the teams they do not pick", () => {
  const r = resolveIdea([m("a", "owner", "ONE"), m("b", "owner", "TWO"), m("c")]);
  const text = renderPrompt(r.options);
  assert.match(text, /captain of 2 of these/);
  assert.match(text, /tell an organizer about the others/);
});

test("no captain warning when they captain none of them", () => {
  const text = renderPrompt(resolveIdea([m("a"), m("b")]).options);
  assert.doesNotMatch(text, /captain/);
});

test("captaining several must ask", () => {
  // arsh.g: 6 ideas, captains 3.
  const r = resolveIdea([m("a", "owner"), m("b", "owner"), m("c")]);
  assert.equal(r.kind, "must_ask");
  assert.equal(r.options.length, 3);
});

test("captaining none of several must ask", () => {
  // bhargav / gagan.jasuja: on 2, captain neither.
  const r = resolveIdea([m("a"), m("b")]);
  assert.equal(r.kind, "must_ask");
  assert.equal(r.options.length, 2);
});

test("a member who must ask cannot mint", () => {
  assert.equal(mayMint(resolveIdea([m("a"), m("b")])), false);
});

test("a non-captain member never mints", () => {
  const r = resolveIdea([m("a", "member")]);
  assert.equal(r.kind, "resolved");
  assert.equal(mayMint(r), false, "a member minting is the duplicate-project bug");
});

test("a stored answer is honoured and stops the asking", () => {
  const rows = [m("a", "owner"), m("b", "owner")];
  assert.deepEqual(resolveIdea(rows, "b"), {
    kind: "resolved",
    ideaId: "b",
    captain: true,
  });
});

test("a stale pin to a team they left is ignored, not obeyed", () => {
  // Otherwise their bundle points at an idea they are no longer on, and the
  // failure looks like a permissions bug rather than a stale row.
  const r = resolveIdea([m("a"), m("b")], "gone");
  assert.equal(r.kind, "must_ask");
});

test("a pin cannot promote a member to captain", () => {
  const r = resolveIdea([m("a", "member"), m("b", "member")], "a");
  assert.equal(r.captain, false);
  assert.equal(mayMint(r), false);
});

test("a duplicated roster row does not turn one membership into a question", () => {
  const r = resolveIdea([m("a", "member"), m("a", "member")]);
  assert.deepEqual(r, { kind: "resolved", ideaId: "a", captain: false });
});

test("owner wins over member if both rows exist for one idea", () => {
  const r = resolveIdea([m("a", "member"), m("a", "owner")]);
  assert.equal(r.captain, true, "losing the captaincy would strand the team");
});

test("rows with no idea_id are discarded rather than counted", () => {
  const r = resolveIdea([{ role: "member" }, m("a", "owner")]);
  assert.deepEqual(r, { kind: "resolved", ideaId: "a", captain: true });
});

test("the prompt puts captained ideas first, then oldest", () => {
  const r = resolveIdea([
    m("x", "member", "MEMBER NEWER", "2026-08-18"),
    m("y", "owner", "CAPTAIN OLDER", "2026-08-10"),
    m("z", "owner", "CAPTAIN NEWER", "2026-08-17"),
  ]);
  assert.deepEqual(
    r.options.map((o) => o.idea_title),
    ["CAPTAIN OLDER", "CAPTAIN NEWER", "MEMBER NEWER"]
  );
  const text = renderPrompt(r.options);
  assert.match(text, /1\. CAPTAIN OLDER {3}← you're the captain/);
  assert.match(text, /3\. MEMBER NEWER$/m);
});

test("the blocked message names the captain", () => {
  // "Ask your captain" without saying who sends them to an organizer instead.
  const text = blockedMessage("WarMly", "someone@plumhq.com");
  assert.match(text, /someone@plumhq\.com/);
  assert.match(text, /WarMly/);
  assert.match(text, /organizer/);
});
