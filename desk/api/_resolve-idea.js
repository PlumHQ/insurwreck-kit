// Which idea's credential bundle belongs to a given person.
//
// Kept as a pure function over the roster rows, with no database access, because
// this is the decision that determines whose Supabase project 136 people end up
// pointing at. It is worth being able to test every branch directly rather than
// by provisioning someone and looking.
//
// THE RULE
//
//   0 memberships              -> solo. A bundle keyed to their email.
//   1 membership               -> that idea.
//   >1, captains exactly one   -> the captained one, with NO prompt.
//   >1, captains none or many  -> ask, with idea titles.
//
// Why ">1 but captains exactly one" resolves silently rather than asking: under
// captain-only minting, that person's team CANNOT be provisioned by anyone else.
// Sending their bundle elsewhere would strand their whole team, so the captaincy
// is not a hint about their intent - it is a hard operational constraint. On the
// current roster that covers 8 of the 12 multi-idea people.
//
// Why solo is a bundle and not a rejection: everyone attending who is on no
// published idea is an organizer. They need tooling to help people on the floor.
//
// The remaining 4 get asked once and the answer is persisted to
// participants.idea_id, so it is a first-run question, not a per-session one.

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

  const captained = rows.filter((r) => r.role === "owner");
  if (captained.length === 1) {
    return { kind: RESOLVED, ideaId: captained[0].idea_id, captain: true };
  }

  // Captains first, then oldest published - so the list a person is shown puts
  // the ideas they are responsible for at the top.
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
    const tag = o.role === "owner" ? "   (you're the captain)" : "";
    return `  ${i + 1}. ${o.idea_title}${tag}`;
  });
  return [
    `You're on ${options.length} published ideas. Which one are you building today?`,
    "",
    ...lines,
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
 */
export function blockedMessage(ideaTitle, captainEmail) {
  return (
    `Your team hasn't been set up yet. ${captainEmail} is the captain for ` +
    `"${ideaTitle}" - once they run /insurwreck:start, run it again and you'll ` +
    `get the same database, hosting and inbox they do. If they can't right now, ` +
    `find an organizer: they can set it up for the team.`
  );
}
