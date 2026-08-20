import { createHash } from "node:crypto";

// Live claims from the Plum base API, masked on the way out.
//
// The warehouse slices in mcp.js are frozen SQL an organizer read line by line,
// so their PII posture is settled once, at publish time. This is the opposite.
// `GET /claims/<id>/` serialises the Claim model with `fields = '__all__'`
// (claims/serializers.py in PlumHQ/plumhq-base-api), so the response carries
// every column the model has today and every column anyone adds after we ship.
// A hand-written list of fields to hide would be wrong the first time someone
// adds one, and nobody would notice until it was in a participant's context.
//
// So masking runs the other way round: anything whose KEY looks like a person,
// or whose VALUE looks like an email or a phone number, is replaced. A short
// exception table names the things that only look like PII - organisation and
// hospital names, filenames. Unknown key holding a PII-shaped value: masked.
// That is the only ordering that stays safe against a schema we do not own.

const API = () => (process.env.PLUM_API_BASE || "").replace(/\/+$/, "");
const TOKEN = () => process.env.PLUM_API_TOKEN || "";

// ------------------------------------------------------------------ mask ---

// Without a salt, sha256 of a ten-digit phone number is not masking - the whole
// keyspace is 10^10 and falls to a laptop in seconds. Falls back to the service
// role key, which is always set on the desk, so this is not one more env var to
// forget on the day. Ceiling: rotating that key re-rolls every pseudonym, which
// only matters if someone is comparing output across the rotation.
const SALT = () =>
  process.env.CLAIMS_MASK_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function digest(value) {
  const salt = SALT();
  if (!salt) throw new Error("masking is unconfigured: set CLAIMS_MASK_SALT");
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 8);
}

const EMAIL_ANY = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g;
const PHONE_ANY = /(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;

// Same person, same token, on every call and in every field - so participants can
// still group, dedupe and count by member without ever seeing who it is.
const maskEmail = (raw) => `${digest(String(raw).trim().toLowerCase())}@masked.invalid`;
const maskPhone = (raw) => `phone_${digest(String(raw).replace(/\D/g, "").slice(-10))}`;
const maskName = (raw) => `Member ${digest(String(raw).trim().toLowerCase())}`;

// A key that names a person. Checked against the exceptions below, never alone.
const PII_KEY = /name|phone|mobile|email|contact/i;

// Things that match PII_KEY and are not people. `hospitalname` is lower-cased in
// the model, hence the case-insensitive prefix rather than an exact list.
const NOT_A_PERSON =
  /^(organisation|organization|brand|company|corporate|insurer|insurance|provider|hospital|clinic|tpa|plan|benefit|policy|section|category|template|bank|city|state)/i;

// Filenames. Masking one to "Member 3f9a" destroys it, but ops name files after
// patients often enough that they still go through the free-text scrubber.
const FILENAME_KEYS = new Set(["name", "displayName", "fileName", "filename", "originalName"]);

// Never useful to a participant, and identifies the person who filed the claim.
const DROP_KEYS = new Set(["userIPAddress"]);

// Postal addresses are dropped rather than masked. A member's address arrives on
// every detail read inside courierDetailsList, and "address" matches none of the
// patterns above - it is not a name, a phone number or an email. Nothing a
// project needs lives in one, and the organisation, hospital, city and state are
// all still there. `emailAddress` is excluded so it goes on to be masked into a
// stable token instead of vanishing.
//
// Bank and government-ID fields ride along in the same place. `userInputFields`
// carries panCard, bankDetailsAccountNo and bankDetailsIFSC - null on a cashless
// claim, filled in on any reimbursement where the member typed their account in
// to get paid. None of it is a name, a phone number or an email, so nothing
// above would have touched it, and none of it is anything a project needs.
const DROP_KEY = /address|pincode|postal|zip|pancard|aadha|ifsc|accountno|bankdetails/i;
const dropped = (key) => DROP_KEYS.has(key) || (DROP_KEY.test(key) && !/email/i.test(key));

// Signed object-store URLs, caught by the value rather than the key.
//
// `documents[].url` and `previewUrl` come back as storage.googleapis.com links
// carrying X-Goog-Signature and X-Goog-Expires=86400 - anyone holding one
// downloads the member's actual discharge summary or itemised bill for the next
// 24 hours. That is a larger leak than any name in this file, and no key pattern
// would have found it: the key is called `url`.
//
// Matched on the signature parameter so it holds for any key and any future
// bucket, and replaced rather than dropped so a project can still see that a
// document exists. documentId, name, sectionTag and the timestamps all stay.
const SIGNED_URL = /[?&](X-Goog-Signature|X-Amz-Signature|Signature)=/i;
const SIGNED_URL_REMOVED = "[signed document url removed]";

const EMAIL_ONLY = new RegExp(`^${EMAIL_ANY.source}$`);
const looksLikeEmail = (s) => EMAIL_ONLY.test(s.trim());

function looksLikePhone(s) {
  const digits = s.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 && /^[6-9]/.test(digits.slice(-10));
}

// Replace the whole value. Which mask depends on the value's shape, not the key,
// so `assignedTo` (an ops email the key pattern misses) still comes out masked.
function maskWhole(value, { unmaskEmail }) {
  const s = String(value);
  if (looksLikeEmail(s)) return unmaskEmail ? s : maskEmail(s);
  if (looksLikePhone(s)) return maskPhone(s);
  return maskName(s);
}

const shouldMask = (key) => PII_KEY.test(key) && !NOT_A_PERSON.test(key);

// Every name this claim tells us about, so it can be removed from the places it
// leaks into as well as the field that declares it.
function knownNames(node) {
  const names = new Set();
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, key));
    if (value && typeof value === "object") {
      return Object.entries(value).forEach(([k, v]) => walk(v, k));
    }
    if (typeof value !== "string" || !value.trim()) return;
    if (!key || !shouldMask(key) || FILENAME_KEYS.has(key)) return;
    if (looksLikeEmail(value) || looksLikePhone(value)) return;
    names.add(value.trim());
  };
  walk(node, null);
  return names;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name shows up inside a filename or an ops note as often as it shows up in
// the field that names it - "RAJESH_KUMAR_discharge.pdf" is the ordinary case,
// not the exotic one - and masking memberName while shipping that filename
// verbatim would be theatre. So each name the claim gives us becomes a pattern
// removed from every other string in it, joined loosely enough to survive the
// underscores and capitals that filenames use.
//
// Deliberately over-eager: a five-letter surname is replaced wherever it appears
// in free text, because a false positive costs a mangled word and a false
// negative costs a member's name. The letter-only boundaries mean digits and
// underscores count as separators, which is exactly how filenames are built.
function nameReplacers(names) {
  const patterns = [];
  for (const name of names) {
    const token = maskName(name);
    const parts = name.split(/[\s._-]+/).filter((part) => part.length >= 3);
    if (parts.length > 1) patterns.push([parts.map(escapeRe).join("[\\s._-]*"), token]);
    for (const part of parts) if (part.length >= 4) patterns.push([escapeRe(part), token]);
  }
  // Longest first, so a full name wins over one of its own parts.
  patterns.sort((a, b) => b[0].length - a[0].length);
  return patterns.map(([pattern, token]) => [
    new RegExp(`(?<![A-Za-z])${pattern}(?![A-Za-z])`, "gi"),
    token,
  ]);
}

// Replace PII-shaped substrings inside a longer string. This is the half that
// catches free text: ops remarks, rejection reasons, filenames. The organizer
// slice guide already documents a column whose top 40 values looked like a tidy
// enum and whose tail was 460 notes with clinic names and patient references.
function scrub(value, { unmaskEmail }, replacers) {
  let out = String(value);
  if (!unmaskEmail) out = out.replace(EMAIL_ANY, (m) => maskEmail(m));
  out = out.replace(PHONE_ANY, (m) => maskPhone(m));
  for (const [pattern, token] of replacers) out = out.replace(pattern, token);
  return out;
}

// Walk the whole response. Depth-first, structure preserved, every leaf seen.
//
// A list is masked claim by claim rather than as one document, so the name
// patterns stay scoped to the claim that produced them. Across a few thousand
// claims a single shared set would mean every string matched against every
// name - quadratic, for no gain, since one claim's free text does not carry
// another member's name.
export function maskClaim(node, options = {}) {
  const opts = { unmaskEmail: Boolean(options.unmaskEmail) };
  if (Array.isArray(node)) return node.map((item) => maskClaim(item, options));

  const replacers = nameReplacers(knownNames(node));

  const walk = (value, key) => {
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (dropped(k)) continue;
        out[k] = walk(v, k);
      }
      return out;
    }
    if (typeof value !== "string" || !value) return value;
    if (SIGNED_URL.test(value)) return SIGNED_URL_REMOVED;
    if (key && shouldMask(key) && !FILENAME_KEYS.has(key)) return maskWhole(value, opts);
    // An institution is not a person. Emails and phone numbers still go, but a
    // hospital called after someone keeps its name - replacing a surname inside
    // "Kumar Hospital" corrupts real signal and protects nobody.
    if (key && PII_KEY.test(key) && !FILENAME_KEYS.has(key)) return scrub(value, opts, []);
    return scrub(value, opts, replacers);
  };

  return walk(node, null);
}

// The exception, kept to one function on purpose.
//
// One project is allowed to see real email addresses. Today that is a flag on
// the participant's credential (set via /api/admin set_unmask_email) plus an env
// list for a same-minute override on the day. When idea-to-token mapping ships,
// this function's body changes and nothing else does - which is why the call
// site takes a boolean and not an idea id. It relaxes EMAIL only: names and
// phone numbers stay masked for everyone, including this project.
export function unmaskEmailFor(participant) {
  if (participant?.unmaskEmail) return true;
  const allowed = String(process.env.CLAIMS_UNMASK_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowed.includes(String(participant?.email || "").toLowerCase());
}

// ------------------------------------------------------------------- api ---

// Upstream accepts two kinds of credential and reads each from its own header,
// so pick by the token's shape rather than making someone match a header to a
// secret they were handed.
//
//   Access-Token           an opaque token looked up in the Token store. No exp.
//   X-Plum-Internal-Token  an HS256 JWT from the auth gateway. base/auth.py
//                          verifies exp, so this one goes stale.
//
// Prefer the opaque one for the desk: a credential that expires mid-event is a
// credential that will expire mid-event.
const isJwt = (token) => token.split(".").length === 3;
const authHeader = () => {
  const token = TOKEN();
  if (!token) return {};
  return isJwt(token) ? { "X-Plum-Internal-Token": token } : { "Access-Token": token };
};

// Read-only by construction, and then by assertion.
//
// The credential the desk holds is an org-wide service token, and the claims
// viewset upstream declares `http_method_names = ['get','post','put','delete',
// 'patch']` on the very paths we read from - `PUT /claims/CL7005/` edits a real
// member's claim, `DELETE` removes it.
//
// Nothing in the tool surface can reach a write today: there are two tools and
// both are reads. This is not that check. It exists so that stays true after the
// next edit to this file, instead of depending on whoever makes it noticing.
// Every outbound call goes through plum(), and plum() will not issue anything
// but GET - a future `plum(path, {}, "POST")` throws here rather than reaching
// production. Same shape and the same reason as guardSelect in mcp.js.
//
// What it does NOT buy us: it is a guard on this client, not on the token. The
// credential itself can still write, so it belongs only in the desk environment
// and never in a participant bundle.
export function guardRead(method) {
  const verb = String(method || "").trim().toUpperCase();
  if (verb !== "GET") {
    throw new Error(`this connection is read-only - refused ${verb || "an empty method"}`);
  }
  return verb;
}

async function plum(path, query = {}, method = "GET") {
  const verb = guardRead(method);
  const base = API();
  if (!base) throw new Error("The claims API isn't configured. Tell an organizer that PLUM_API_BASE is unset.");
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { method: verb, headers: { ...authHeader(), Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    // The service credential is an HS256 JWT the auth gateway issues with an
    // expiry, and base/auth.py verifies exp. So a 401 here is far more likely to
    // be an expired token than a wrong one, and "refused (401)" would send
    // someone hunting for a bug that isn't there.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "The claims API rejected the desk's credential. Tell an organizer that " +
          "PLUM_API_TOKEN needs reissuing" +
          (isJwt(TOKEN()) ? " - it is a JWT and it expires." : ".")
      );
    }
    // Never relay the upstream body otherwise: a DRF validation error echoes the
    // query back, and a 500 can carry a traceback with real values in it.
    throw new Error(`The claims API refused that request (${res.status}).`);
  }
  return text ? JSON.parse(text) : null;
}

// What the list endpoint actually accepts. ClaimListConsumer.Meta.fields, no
// more: anything else is silently dropped by DRF, and a filter that looks like
// it applied but didn't is worse than a refusal.
const LIST_FILTERS = new Set([
  "memberId",
  "organisationId",
  "insurerClaimId",
  "stage",
  "stageGroup",
  "excludeStages",
  "typeOfClaim",
  "typeOfBenefit",
]);

// ClaimListConsumer declares pageSize as `max_value=10, default=50`, and DRF
// does not validate defaults - so omitting it returns 50 a page while asking for
// anything above 10 is a 400. We omit it and page instead of capping, because
// "no cap" on an endpoint that caps you at 10 per request has to mean paging.
//
// `_links.next` upstream is `current_count >= limit`, a might-be-more hint
// rather than a fact, so a full last page still advertises a next that lands on
// an empty one. Hence the empty-results break as well.
const MAX_PAGES = 200;

export async function listClaims(filters = {}, participant) {
  const query = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (!LIST_FILTERS.has(key)) {
      throw new Error(`Unknown filter "${key}". Allowed: ${[...LIST_FILTERS].join(", ")}.`);
    }
    query[key] = value;
  }

  const rows = [];
  let page = 1;
  let complete = true;
  for (; page <= MAX_PAGES; page += 1) {
    const body = await plum("/claims/", { ...query, page });
    const results = Array.isArray(body) ? body : body?.results || [];
    rows.push(...results);
    if (!results.length || !body?._links?.next) break;
    if (page === MAX_PAGES) complete = false;
  }

  const unmaskEmail = unmaskEmailFor(participant);
  return {
    row_count: rows.length,
    pages_fetched: Math.min(page, MAX_PAGES),
    // Say so rather than returning a partial answer that reads like a whole one.
    ...(complete ? {} : { complete: false, note: `Stopped at ${MAX_PAGES} pages. Narrow the filters.` }),
    masked: unmaskEmail ? "names and phone numbers" : "names, phone numbers and email addresses",
    claims: maskClaim(rows, { unmaskEmail }),
  };
}

// Opt-in sections on the detail endpoint, by the name a participant would use.
//
// `previously_uploaded` is deliberately not a default. Asking for it forces
// returnDocuments on upstream anyway, then deletes hospitalisationStage,
// providerDMSFileURL and providerDMSFilePath out of the very document dicts the
// documents array is later serialised from - so you get a second, differently
// shaped copy of the same documents and three fields quietly missing from the
// first. It answers one UI question ("what did they submit before this round of
// document requests"), which is derivable from the documents we already return.
const SECTIONS = {
  documents: "returnDocuments",
  status: "returnStatusContent",
  status_variables: "returnStatusContentVariables",
  comments: "returnComments",
  faqs: "returnFaqs",
  review: "returnReviewDetails",
  ailments: "returnAilmentTreatments",
  previously_uploaded: "returnPreviouslyUploadedDocuments",
};

export const SECTION_NAMES = Object.keys(SECTIONS);
const DEFAULT_SECTIONS = ["documents", "status"];

export async function getClaim(claimId, include, participant) {
  const id = String(claimId || "").trim();
  if (!id) throw new Error("claim_id is required, e.g. CL7005.");

  const wanted = Array.isArray(include) && include.length ? include : DEFAULT_SECTIONS;
  const query = {};
  for (const section of wanted) {
    const param = SECTIONS[section];
    if (!param) throw new Error(`Unknown section "${section}". Allowed: ${SECTION_NAMES.join(", ")}.`);
    query[param] = "true";
  }

  const claim = await plum(`/claims/${encodeURIComponent(id)}/`, query);
  const unmaskEmail = unmaskEmailFor(participant);
  return {
    sections: wanted,
    masked: unmaskEmail ? "names and phone numbers" : "names, phone numbers and email addresses",
    claim: maskClaim(claim, { unmaskEmail }),
  };
}
