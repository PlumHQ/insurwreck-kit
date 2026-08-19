import { createHash, randomInt, randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Thin PostgREST client — the desk is dependency-free on purpose.
export async function sb(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status} on ${path.split("?")[0]}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// PostgREST caps a plain select at 1000 rows, silently. llm_usage passed that
// mark mid-event and every spend figure started drifting downward as new rows
// shifted which 1000 came back - the roster under-reported, and worse, the
// gateway's own budget check would have stopped growing at 1000 calls and let
// someone spend without a ceiling. Page until the server returns a short page.
// Callers must pass a stable `order` or the pages overlap.
export async function sbAll(path, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const page = await sb(path, {
      headers: { Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" },
    });
    if (!Array.isArray(page)) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const newOtpCode = () => String(randomInt(0, 1000000)).padStart(6, "0");
export const newToken = () => randomBytes(24).toString("hex");
export const nowIso = () => new Date().toISOString();

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function emailAllowed(email) {
  const domain = (process.env.ALLOWED_DOMAIN || "plumhq.com").toLowerCase();
  const extras = (process.env.ALLOWED_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return email.endsWith(`@${domain}`) || extras.includes(email);
}

export function isAdmin(req) {
  const key = process.env.ADMIN_KEY;
  return Boolean(key) && req.headers["x-admin-key"] === key;
}

// An organizer is either someone holding the shared ADMIN_KEY, or someone whose
// verified session belongs to an address on the ORGANIZER_EMAILS list. The
// second path lets organizers sign in with the same six-digit code participants
// use, instead of pasting a secret into a browser. Deliberately an env var and
// not a table: the list changes twice ever, and a table is one more place a
// compromise could promote someone.
export async function organizerFor(req) {
  if (isAdmin(req)) return "admin-key";
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const allowed = new Set(
    String(process.env.ORGANIZER_EMAILS || "")
      .toLowerCase()
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
  );
  if (!allowed.size) return null;
  const rows = await sb(
    `sessions?token_hash=eq.${sha256(token)}&expires_at=gt.${nowIso()}&select=email&limit=1`
  );
  const email = rows.length ? normalizeEmail(rows[0].email) : null;
  return email && allowed.has(email) ? email : null;
}

// A participant, identified by the bearer token minted for them as their
// Anthropic-proxy credential (the same $INSURWRECK_TOKEN their MCP servers
// and any direct desk call use). Shared by /api/mcp and /api/risks so there's
// one place that resolves a token to an email.
export async function participantFor(req) {
  const auth = req.headers.authorization || "";
  const header = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = header || String(req.headers["x-api-key"] || "").trim();
  if (!token) return null;
  const rows = await sb(
    `credentials?service=eq.anthropic&revoked_at=is.null` +
      `&payload->>token_hash=eq.${sha256(token)}` +
      `&select=participant_email,payload&limit=1`
  );
  if (!rows.length) return null;
  return { email: rows[0].participant_email, full: Boolean(rows[0].payload?.full_data_access) };
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

export function resendFrom() {
  return process.env.RESEND_FROM || "Insurwreck 4.0 <insurwreck@badge.plumhq.com>";
}
