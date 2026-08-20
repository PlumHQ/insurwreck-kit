// slugForIdea names things that are externally visible and effectively
// permanent: the Vercel project (and therefore the deploy URL), the Supabase
// project, the AgentMail address, the n8n workflow prefix. A collision means two
// teams sharing one project; an invalid character means a mint that 400s on the
// day.
//
// Run: node desk/test-slug-for-idea.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { slugForIdea, slugFor } from "./api/_minters.js";

const ID_A = "0b9a8882-7fb0-4c4c-9c50-2db6c66965a6";
const ID_B = "7e1c03ba-5e44-442c-bbf9-2d2f6afcbb7f";

test("same title, different idea -> different slug", () => {
  // The roster genuinely holds two published ideas both called "Insurwreck -
  // The Collective Brain". Hashing the title would give them one slug, and the
  // second mint would silently adopt the first team's project.
  const a = slugForIdea(ID_A, "Insurwreck — The Collective Brain");
  const b = slugForIdea(ID_B, "INSURWRECK — THE COLLECTIVE BRAIN");
  assert.notEqual(a, b);
});

test("stable across calls", () => {
  assert.equal(slugForIdea(ID_A, "meridian"), slugForIdea(ID_A, "meridian"));
});

test("the hash follows the id, not the title", () => {
  // A title edit in the hub must not rename a live project.
  const before = slugForIdea(ID_A, "meridian");
  const after = slugForIdea(ID_A, "Meridian (v2)");
  assert.equal(before.slice(-4), after.slice(-4));
});

test("output is a valid project name and subdomain label", () => {
  for (const title of [
    "PLUM CAREBOT — CONVERSATIONAL HEALTH CHECKUP BOOKING  THE IDEA",
    "What-SKU-p",
    "Recall --- Evidence-Grounded Outbound",
    "360 Review",
    "Suits of plum",
  ]) {
    const slug = slugForIdea(ID_A, title);
    assert.match(slug, /^[a-z0-9-]+$/, `bad chars: ${slug}`);
    assert.doesNotMatch(slug, /^-|-$/, `leading/trailing hyphen: ${slug}`);
    assert.doesNotMatch(slug, /--/, `double hyphen: ${slug}`);
    assert.ok(slug.length <= 63, `too long for a subdomain label: ${slug}`);
  }
});

test("a title of only punctuation still yields a usable name", () => {
  // "iw--7e1c" would be rejected by Vercel and is not a legal DNS label.
  for (const title of ["———", "", "   ", "!!!", null, undefined]) {
    const slug = slugForIdea(ID_A, title);
    assert.match(slug, /^iw-idea-[0-9a-f]{4}$/, `got ${slug} for ${JSON.stringify(title)}`);
  }
});

test("a long title is truncated without leaving a trailing hyphen", () => {
  const slug = slugForIdea(ID_A, "aaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbb cccccc");
  assert.doesNotMatch(slug, /--/);
  assert.doesNotMatch(slug, /-$/);
  assert.ok(slug.length <= 40);
});

test("the email slug is untouched, so solo bundles keep working", () => {
  // Organizers are on no published idea and still provision by email.
  assert.equal(slugFor("rohit.mudili@plumhq.com"), "iw-rohit-mudili-4c90");
});

test("distinct ideas do not collide across a realistic set", () => {
  const titles = [
    "meridian", "Kept", "Risk Pulse", "AM Command Center", "Pre-Empt",
    "WarMly", "Dispute Management", "Insurer Radar", "BridgeForge", "360 Review",
  ];
  const slugs = titles.map((t, i) =>
    slugForIdea(`${i}${ID_A.slice(1)}`, t)
  );
  assert.equal(new Set(slugs).size, slugs.length);
});
