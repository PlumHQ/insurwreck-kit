// Pull the published-idea roster from the hub into the desk's idea_teams table.
//
//   HUB_URL=... HUB_SECRET_KEY=... \
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node desk/scripts/refresh-idea-teams.mjs [--dry-run]
//
// Run the night before onboarding opens, and again on demand if the roster
// changes. Not called from the request path on purpose: resolving an email to an
// idea on every provision would make onboarding for 136 people depend on the hub
// being reachable at 9am on the day, which is the worst possible moment to add a
// dependency to. The roster is final - there is no confirmation step - so a
// snapshot is strictly safer than a live join.
//
// WHAT COUNTS AS A LIVE IDEA
//
//   ideas.status = 'published'  AND  ideas.hidden = false
//     AND NOT EXISTS (idea_review_notes.skipped_at for that idea)
//
// The skipped_at clause is currently redundant - all 9 skipped ideas are already
// hidden - but that is a property of today's data, not a rule the hub enforces,
// and a skipped idea silently acquiring a Supabase project would be nobody's
// job to notice.
//
// SAFETY
//
// Never a blind delete-then-insert. A hub that returns an empty list because a
// key expired would otherwise wipe the roster, and the symptom would be 136
// people resolving to solo bundles - which succeeds, mints 136 projects, and
// looks like it worked. So: refuse to apply a result that is empty or that
// shrinks the roster by more than a third unless --force says otherwise.

const HUB_URL = must("HUB_URL");
const HUB_KEY = must("HUB_SECRET_KEY");
const DESK_URL = must("SUPABASE_URL");
const DESK_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const SHRINK_LIMIT = 1 / 3;

function must(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is not set.`);
    process.exit(1);
  }
  return value.replace(/\/+$/, "");
}

async function rest(base, key, path) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------- read hub ---

const [ideas, members, profiles, notes] = await Promise.all([
  rest(HUB_URL, HUB_KEY, "ideas?select=id,title,brief,status,hidden,published_at"),
  rest(HUB_URL, HUB_KEY, "team_members?select=idea_id,member_id,role"),
  rest(HUB_URL, HUB_KEY, "profiles?select=user_id,email"),
  rest(HUB_URL, HUB_KEY, "idea_review_notes?select=idea_id,skipped_at"),
]);

const skipped = new Set(notes.filter((n) => n.skipped_at).map((n) => n.idea_id));
const live = new Map(
  ideas
    .filter((i) => i.status === "published" && !i.hidden && !skipped.has(i.id))
    .map((i) => [i.id, i])
);
const emailOf = new Map(profiles.map((p) => [p.user_id, String(p.email).trim().toLowerCase()]));

// `summary` is plain prose and is what we want. `pitch` is HTML written in a rich
// text editor, so it is stripped rather than shown raw - a brief full of <p> tags
// is worse than no brief, because idea-to-template feeds it to a model verbatim.
function briefText(brief) {
  if (!brief || typeof brief !== "object") return null;
  const raw = brief.summary || brief.pitch || "";
  const text = String(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, 2000) : null;
}

const rows = [];
const orphans = [];
for (const m of members) {
  const idea = live.get(m.idea_id);
  if (!idea) continue;
  const email = emailOf.get(m.member_id);
  // A membership whose profile is missing cannot be resolved from an email, so
  // it would silently drop that person off their team. Counted and reported
  // rather than skipped quietly.
  if (!email) {
    orphans.push(m);
    continue;
  }
  rows.push({
    idea_id: m.idea_id,
    member_email: email,
    role: m.role,
    idea_title: idea.title,
    idea_brief: briefText(idea.brief),
    published_at: idea.published_at,
  });
}

const captains = new Set(rows.filter((r) => r.role === "owner").map((r) => r.idea_id));
const people = new Set(rows.map((r) => r.member_email));

console.log(`hub          : ${ideas.length} ideas, ${members.length} memberships`);
console.log(`live         : ${live.size} ideas (published, not hidden, not skipped)`);
console.log(`snapshot     : ${rows.length} rows, ${people.size} distinct people`);
console.log(`captains     : ${captains.size} of ${live.size} ideas have an owner row`);
if (live.size !== captains.size) {
  console.warn(`WARN: ${live.size - captains.size} live idea(s) have NO owner row - nobody can provision them.`);
}
if (orphans.length) {
  console.warn(`WARN: ${orphans.length} membership(s) dropped - no hub profile, so no email to key on.`);
}

// -------------------------------------------------------------- guard rails ---

// A dry run reports what WOULD be written, so it must not require desk
// credentials to be reachable - the point is to check the hub read and the
// resolution outcome, which is exactly what you want to do from a laptop.
let existing = [];
try {
  existing = await rest(DESK_URL, DESK_KEY, "idea_teams?select=idea_id");
  console.log(`desk (before): ${existing.length} rows`);
} catch (err) {
  if (!DRY_RUN) throw err;
  console.log(`desk (before): unreachable (${String(err.message).slice(0, 60)}) - fine for --dry-run`);
}

if (rows.length === 0) {
  console.error("REFUSING: the hub returned no live memberships. An expired key looks exactly like this.");
  process.exit(1);
}
if (existing.length > 0 && rows.length < existing.length * (1 - SHRINK_LIMIT) && !FORCE) {
  console.error(
    `REFUSING: the roster would shrink from ${existing.length} to ${rows.length} rows. ` +
      `Re-run with --force if that is genuinely intended.`
  );
  process.exit(1);
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
  const multi = new Map();
  for (const r of rows) multi.set(r.member_email, (multi.get(r.member_email) || 0) + 1);
  const asked = [...multi.entries()].filter(([, n]) => n > 1);
  console.log(`${asked.length} people are on more than one live idea and will be asked to choose:`);
  for (const [who, n] of asked.sort((a, b) => b[1] - a[1])) console.log(`  ${who} (${n})`);
  process.exit(0);
}

// ------------------------------------------------------------------- write ---

// Upsert, then delete what is no longer in the roster. In that order: an upsert
// that fails leaves the old roster intact, where a delete-first that fails
// leaves no roster at all.
const upsert = await fetch(`${DESK_URL}/rest/v1/idea_teams?on_conflict=idea_id,member_email`, {
  method: "POST",
  headers: {
    apikey: DESK_KEY,
    Authorization: `Bearer ${DESK_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }))),
});
if (!upsert.ok) {
  console.error(`upsert failed: ${upsert.status} ${await upsert.text()}`);
  process.exit(1);
}
console.log(`upserted     : ${rows.length} rows`);

const keep = new Set(rows.map((r) => `${r.idea_id}|${r.member_email}`));
const stale = existing.length
  ? (await rest(DESK_URL, DESK_KEY, "idea_teams?select=idea_id,member_email")).filter(
      (r) => !keep.has(`${r.idea_id}|${r.member_email}`)
    )
  : [];

for (const r of stale) {
  const res = await fetch(
    `${DESK_URL}/rest/v1/idea_teams?idea_id=eq.${r.idea_id}&member_email=eq.${encodeURIComponent(r.member_email)}`,
    { method: "DELETE", headers: { apikey: DESK_KEY, Authorization: `Bearer ${DESK_KEY}`, Prefer: "return=minimal" } }
  );
  if (!res.ok) console.error(`  could not remove ${r.member_email} from ${r.idea_id}: ${res.status}`);
}
console.log(`removed      : ${stale.length} row(s) no longer on the roster`);
console.log("\ndone.");
