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
