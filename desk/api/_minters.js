import { createHash, randomBytes } from "node:crypto";
import { resendFrom } from "./_lib.js";

const VERCEL_API = "https://api.vercel.com";
const SUPABASE_API = "https://api.supabase.com/v1";
const TOKEN_TTL_DAYS = 45;

// Deterministic per-participant resource name: iw-<local-part>-<hash4>.
export function slugFor(email) {
  const local = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const suffix = createHash("sha256").update(email).digest("hex").slice(0, 4);
  return `iw-${local}-${suffix}`;
}

function finalize(payload, pendingParts) {
  if (pendingParts.length) {
    payload.incomplete = true;
    payload.pending_parts = pendingParts;
  } else {
    delete payload.incomplete;
    delete payload.pending_parts;
  }
  return payload;
}

// ---------------------------------------------------------------- resend ---

export async function mintResend(email, existing = {}) {
  const payload = { ...existing };
  if (!payload.api_key) {
    const response = await fetch("https://api.resend.com/api-keys", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `insurwreck-${email}`, permission: "sending_access" }),
    });
    if (!response.ok) {
      throw new Error(`resend key mint failed: ${response.status} ${await response.text()}`);
    }
    const key = await response.json();
    payload.api_key = key.token;
    payload.key_id = key.id;
    payload.from = resendFrom();
    payload.note = "Sending-only Resend key for the shared hackathon domain.";
  }
  return finalize(payload, []);
}

// ---------------------------------------------------------------- vercel ---

export async function mintVercel(email, existing = {}) {
  const master = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const teamSlug = process.env.VERCEL_TEAM_SLUG || "insurwreck";
  const slug = slugFor(email);
  const payload = { ...existing };
  const auth = (token) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  if (!payload.project_id) {
    const res = await fetch(`${VERCEL_API}/v10/projects?teamId=${teamId}`, {
      method: "POST",
      headers: auth(master),
      body: JSON.stringify({ name: slug }),
    });
    const data = await res.json();
    if (res.ok) {
      payload.project_id = data.id;
    } else if (res.status === 409 || /already exists/i.test(data?.error?.message || "")) {
      const lookup = await fetch(`${VERCEL_API}/v9/projects/${slug}?teamId=${teamId}`, {
        headers: auth(master),
      });
      if (!lookup.ok) {
        throw new Error(`vercel project exists but lookup failed: ${lookup.status}`);
      }
      payload.project_id = (await lookup.json()).id;
    } else {
      throw new Error(`vercel project create failed: ${res.status} ${JSON.stringify(data)}`);
    }
    payload.project_name = slug;
    payload.team_id = teamId;
    payload.team_slug = teamSlug;
    payload.dashboard_url = `https://vercel.com/${teamSlug}/${slug}`;
  }

  if (!payload.token) {
    // Token minting needs a PERSONAL-scope Vercel token (VERCEL_USER_TOKEN).
    // A team-scoped token gets 403 here; the project still provisions and the
    // token fills in on the next provision call once the env var is set.
    const minter = process.env.VERCEL_USER_TOKEN || master;
    const res = await fetch(`${VERCEL_API}/v3/user/tokens`, {
      method: "POST",
      headers: auth(minter),
      body: JSON.stringify({
        name: `insurwreck-${email}`,
        expiresAt: Date.now() + TOKEN_TTL_DAYS * 86400000,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.bearerToken) {
      payload.token = data.bearerToken;
      payload.token_id = data.token?.id;
      payload.note = `Deploy with: vercel link --project ${payload.project_name} --scope ${teamSlug} --token <token> && vercel deploy --token <token>`;
    } else {
      console.error(`vercel token mint failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
    }
  }

  return finalize(payload, payload.token ? [] : ["token"]);
}

// -------------------------------------------------------------- supabase ---

export async function mintSupabase(email, existing = {}) {
  const token = process.env.SUPABASE_MGMT_TOKEN;
  const org = process.env.SUPABASE_ORG_ID;
  const region = process.env.SUPABASE_REGION || "ap-south-1";
  const payload = { ...existing };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (!payload.project_ref) {
    const dbPass = randomBytes(18).toString("base64url");
    const res = await fetch(`${SUPABASE_API}/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        organization_id: org,
        name: slugFor(email),
        region,
        db_pass: dbPass,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`supabase project create failed: ${res.status} ${JSON.stringify(data)}`);
    }
    payload.project_ref = data.ref || data.id;
    payload.db_password = dbPass;
    payload.region = region;
    payload.url = `https://${payload.project_ref}.supabase.co`;
    payload.dashboard_url = `https://supabase.com/dashboard/project/${payload.project_ref}`;
  }

  if (!payload.service_role_key) {
    // New projects take ~a minute to come up; poll briefly, then leave the
    // keys as a pending part that the next provision call repairs.
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline) {
      const res = await fetch(
        `${SUPABASE_API}/projects/${payload.project_ref}/api-keys?reveal=true`,
        { headers }
      );
      if (res.ok) {
        const keys = await res.json().catch(() => []);
        const anon = Array.isArray(keys) && keys.find((k) => k.name === "anon");
        const service = Array.isArray(keys) && keys.find((k) => k.name === "service_role");
        if (anon?.api_key && service?.api_key) {
          payload.anon_key = anon.api_key;
          payload.service_role_key = service.api_key;
          payload.note = "Your own Supabase project. Use the service_role key server-side only.";
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  return finalize(payload, payload.service_role_key ? [] : ["api_keys"]);
}
