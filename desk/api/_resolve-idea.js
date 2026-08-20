// Which idea's credential bundle belongs to a given person.
//
// Kept as a pure function over the roster rows, with no database access, because
// this is the decision that determines whose Supabase project 136 people end up
// pointing at. It is worth being able to test every branch directly rather than
// by provisioning someone and looking.
//
// THE RULE
//
//   0 memberships   -> solo. A bundle keyed to their email.
//   1 membership    -> that idea.
//   >1 memberships  -> ALWAYS ask, with idea titles. No exceptions.
//
// "Always ask" is a deliberate call, taken over a rule that silently resolved
// anyone captaining exactly one of their ideas. Guessing is worse than asking:
// the wrong guess points somebody at a teammate's database and nothing about it
// looks broken. On the current roster this asks 12 people instead of 4.
//
// It does carry a real risk, and the prompt is where it gets mitigated. Under
// captain-only minting, a captain who picks a DIFFERENT idea leaves their own
// team with nobody able to provision it. So captained options are flagged in the
// prompt with what happens if they are not chosen - see renderPrompt.
//
// Why solo is a bundle and not a rejection: everyone attending who is on no
// published idea is an organizer. They need tooling to help people on the floor.
//
// The answer is persisted to participants.idea_id, so this is a first-run
// question, not a per-session one.

/** @typedef {{idea_id: string, role: 'owner'|'member', idea_title: string, published_at: string|null}} Membership */

export const SOLO = "solo";
export const RESOLVED = "resolved";
export const MUST_ASK = "must_ask";

/**
 * @param {Membership[]} memberships  rows from idea_teams for ONE email
 * @param {string|null} [pinned]      participants.idea_id, if already chosen
 * @returns {{kind: 'solo'} | {kind: 'resolved', ideaId: string, captain: boolean}
 *          | {kind: 'must_ask', options: Membership[]}}
 */
export function resolveIdea(memberships, pinned = null) {
  const rows = dedupe(memberships);

  // A previously stored answer wins outright - that is the entire point of
  // asking once. But only if it is still a membership: a pin left over from a
  // team they were removed from would otherwise send their bundle to an idea
  // they are no longer on.
  if (pinned) {
    const hit = rows.find((r) => r.idea_id === pinned);
    if (hit) return { kind: RESOLVED, ideaId: hit.idea_id, captain: hit.role === "owner" };
  }

  if (rows.length === 0) return { kind: SOLO };
  if (rows.length === 1) {
    return { kind: RESOLVED, ideaId: rows[0].idea_id, captain: rows[0].role === "owner" };
  }

  // More than one membership always asks, even when only one of them is
  // captained. See the note at the top of this file.
  return { kind: MUST_ASK, options: sortForPrompt(rows) };
}

/**
 * The same roster rows, deduped by idea. A person cannot hold two roles on one
 * idea, but the snapshot is assembled from a join and a duplicated row would
 * silently turn "one membership" into "must ask".
 */
function dedupe(memberships) {
  const byIdea = new Map();
  for (const row of memberships || []) {
    if (!row?.idea_id) continue;
    const existing = byIdea.get(row.idea_id);
    // owner beats member if both somehow appear.
    if (!existing || (existing.role !== "owner" && row.role === "owner")) {
      byIdea.set(row.idea_id, row);
    }
  }
  return [...byIdea.values()];
}

function sortForPrompt(rows) {
  return [...rows].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return String(a.published_at || "").localeCompare(String(b.published_at || ""));
  });
}

/**
 * The question, rendered. Lives here rather than in the command file so the
 * titles come from the same rows the decision was made on - a prompt that lists
 * different ideas than the resolver considered is worse than no prompt.
 */
export function renderPrompt(options) {
  const lines = options.map((o, i) => {
    const tag = o.role === "owner" ? "   ← you're the captain" : "";
    return `  ${i + 1}. ${o.idea_title}${tag}`;
  });

  // The warning is the whole mitigation for "always ask". A captain who picks
  // one of their other ideas leaves the team they captain with nobody able to
  // provision it, and that team's first symptom is a database that never
  // appears. Say so at the point of choosing, not in a runbook.
  const captained = options.filter((o) => o.role === "owner");
  const warning =
    captained.length === 0
      ? []
      : [
          "",
          captained.length === 1
            ? `Note: you're the captain of "${captained[0].idea_title}". If you pick something else, ` +
              `nobody on that team can set it up - tell an organizer so they can do it for them.`
            : `Note: you're the captain of ${captained.length} of these. Only the one you pick gets ` +
              `set up automatically; tell an organizer about the others so they can set those teams up.`,
        ];

  return [
    `You're on ${options.length} published ideas. Which one are you building today?`,
    "",
    ...lines,
    ...warning,
    "",
    "This is asked once - it decides which team's database, hosting and inbox you get.",
  ].join("\n");
}

/**
 * Whether this person may mint for the idea they resolved to.
 *
 * Captain-only, decided deliberately: a member who starts before their captain
 * is told to wait rather than minting a second project for the same team. The
 * cost is that a team whose captain has not started is blocked, which is why
 * organizers can provision on anyone's behalf through the existing
 * organizerFor() path in provision.js.
 */
export function mayMint(resolution) {
  if (resolution.kind === SOLO) return true;
  return resolution.kind === RESOLVED && resolution.captain === true;
}

/**
 * What a blocked member is told. Names the captain, because "ask your captain"
 * without saying who sends them to find an organizer instead.
 *
 * Two cases, and they are different asks. "Not started" needs the captain to
 * begin; "started and stopped" needs them to run it AGAIN, which is not obvious
 * - a captain whose laptop slept mid-provision has no reason to think anything
 * is outstanding, and telling their teammate "hasn't been set up yet" sends both
 * of them looking for the wrong problem.
 */
export function blockedMessage(ideaTitle, captainEmail, partial = false) {
  const who = captainEmail || "your captain";
  if (partial) {
    return (
      `${who} started setting up "${ideaTitle}" but it did not finish - a laptop ` +
      `sleeping or Claude Code closing mid-run will do that. Ask them to run ` +
      `/insurwreck:start again; it picks up exactly where it stopped. Then run it ` +
      `yourself and you will get the same database, hosting and inbox. If they ` +
      `cannot right now, an organizer can finish it for the team.`
    );
  }
  return (
    `Your team hasn't been set up yet. ${who} is the captain for ` +
    `"${ideaTitle}" - once they run /insurwreck:start, run it again and you'll ` +
    `get the same database, hosting and inbox they do. If they can't right now, ` +
    `find an organizer: they can set it up for the team.`
  );
}
