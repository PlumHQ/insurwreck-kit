import { sb, nowIso } from "./_lib.js";

// Keka OAuth authorization-code flow. Every token here belongs to one employee
// who logged in at Keka themselves, so Keka enforces their permissions on
// every call — the desk holds no tenant-wide key and grants no extra reach.
// Read env lazily, like /api/mcp does, so config is never frozen at import.
const LOGIN_HOST = () => process.env.KEKA_LOGIN_HOST || "login.keka.com";
const CLIENT_ID = () => process.env.KEKA_CLIENT_ID || "";
const CLIENT_SECRET = () => process.env.KEKA_CLIENT_SECRET || "";
const SCOPE = () => process.env.KEKA_SCOPE || "kekaapi offline_access";
// Tenant API host, e.g. https://plum.keka.com — no trailing slash.
const API_BASE = () => (process.env.KEKA_API_BASE || "").replace(/\/+$/, "");
const deskBase = () =>
  (process.env.DESK_BASE_URL || "https://insurwreck-desk.preview.plumhq.com").replace(/\/+$/, "");

export const kekaConfigured = () => Boolean(CLIENT_ID() && CLIENT_SECRET() && API_BASE());

export const redirectUri = () => `${deskBase()}/api/keka-callback`;

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID(),
    redirect_uri: redirectUri(),
    scope: SCOPE(),
    state,
  });
  return `https://${LOGIN_HOST()}/connect/authorize?${params}`;
}

async function postToken(params) {
  const res = await fetch(`https://${LOGIN_HOST()}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      scope: SCOPE(),
      ...params,
    }).toString(),
  });
  // Token endpoints return non-JSON on some failures; read text first so a
  // 502 HTML page surfaces as itself instead of a JSON parse error.
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`keka token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `keka token ${res.status}`);
  }
  if (!data.access_token) throw new Error("keka returned no access_token");
  return data;
}

async function storeTokens(email, data, previousRefresh) {
  // Keka omits refresh_token on some refresh responses; keep the old one.
  const refresh = data.refresh_token || previousRefresh || null;
  const expiresAt = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000).toISOString();
  await sb("keka_tokens?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      email,
      access_token: data.access_token,
      refresh_token: refresh,
      expires_at: expiresAt,
      updated_at: nowIso(),
    },
  });
  return { accessToken: data.access_token, refreshToken: refresh, expiresAt };
}

export async function exchangeCode(email, code) {
  const data = await postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
  return storeTokens(email, data, null);
}

// Returns a live access token for this participant, refreshing when it is
// within 60s of expiry. Null means they have never connected Keka.
async function accessTokenFor(email) {
  const rows = await sb(
    `keka_tokens?email=eq.${encodeURIComponent(email)}&select=access_token,refresh_token,expires_at&limit=1`
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (new Date(row.expires_at).getTime() - Date.now() > 60000) return row.access_token;
  if (!row.refresh_token) return null;
  const data = await postToken({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  const stored = await storeTokens(email, data, row.refresh_token);
  return stored.accessToken;
}

export class KekaNotConnected extends Error {}

export async function kekaFetch(email, path, { method = "GET", query, body } = {}) {
  const token = await accessTokenFor(email);
  if (!token) {
    throw new KekaNotConnected(
      "Keka is not connected for this account. Run /insurwreck:keka-connect and finish the Keka login."
    );
  }
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${API_BASE()}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`keka ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Verified against Keka's published API directory (base
// https://{company}.{environment}.com). Query-parameter NAMES below are the
// documented filters; if Keka rejects one on your tenant, fix it here — every
// tool routes through this table.
// ponytail: params unverified against a live tenant; keka_raw_get is the
// escape hatch so a wrong name never blocks a participant.
export const EMPLOYEES_PATH = "/api/v1/hris/employees";
export const ROUTES = {
  leave_types: { path: "/api/v1/time/leavetypes" },
  leave_balance: { path: "/api/v1/time/leavebalance" },
  leave_requests: { path: "/api/v1/time/leaverequests" },
  attendance: { path: "/api/v1/time/attendance" },
  holidays: { path: "/api/v1/time/holidayscalendar" },
};

// Keka has no /me endpoint, so resolve the caller's own employee record by
// matching the email the desk already verified over OTP.
export async function resolveSelf(email) {
  const data = await kekaFetch(email, EMPLOYEES_PATH, { query: { search: email } });
  const list = Array.isArray(data) ? data : data?.data || [];
  const match = list.find((e) =>
    [e.email, e.workEmail, e.officialEmail, e.personalEmail]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === email)
  );
  if (!match) {
    throw new Error(
      `No Keka employee found for ${email}. The Keka account you authorised may use a different work email.`
    );
  }
  return match;
}
