import { createHash, randomBytes } from "node:crypto";
import { resendFrom } from "./_lib.js";

const VERCEL_API = "https://api.vercel.com";
const SUPABASE_API = "https://api.supabase.com/v1";
const AGENTMAIL_API = "https://api.agentmail.to/v0";
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

  if (!payload.public_deployments) {
    // New-team default is Vercel Authentication on every deployment URL.
    // Participants have no Vercel dashboard logins, so their deploys must be
    // publicly accessible — disable deployment protection on their project.
    const res = await fetch(`${VERCEL_API}/v9/projects/${payload.project_id}?teamId=${teamId}`, {
      method: "PATCH",
      headers: auth(master),
      body: JSON.stringify({ ssoProtection: null }),
    });
    if (res.ok) {
      payload.public_deployments = true;
    } else {
      console.error(`vercel protection disable failed for ${slug}: ${res.status} ${await res.text()}`);
    }
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

  const vercelPending = [];
  if (!payload.token) vercelPending.push("token");
  if (!payload.public_deployments) vercelPending.push("public_access");
  return finalize(payload, vercelPending);
}

// ----------------------------------------------------------- google auth ---

// Domain enforcement lives INSIDE the participant's project as a
// before-user-created hook, so it holds even if the Google console config is
// later loosened. The Internal OAuth consent screen is the primary lock; this
// is defence in depth.
function domainGuardSql(domain) {
  const safe = domain.replace(/[^a-z0-9.-]/gi, "");
  return `
create or replace function public.insurwreck_restrict_signup_domain(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  user_email text;
begin
  user_email := lower(coalesce(event->'user'->>'email', ''));
  if user_email like '%@${safe}' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Only ${safe} accounts can sign in to this Insurwreck app.'
    )
  );
end;
$$;

grant execute on function public.insurwreck_restrict_signup_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.insurwreck_restrict_signup_domain(jsonb) from authenticated, anon, public;
`;
}

// Google validates redirect_uri before anything else on the authorize
// endpoint, so probing it tells us whether an organizer has registered this
// callback yet — no API needed. Fails closed: any doubt counts as
// unregistered, so a participant is never told sign-in works when it doesn't.
export async function callbackRegistered(clientId, redirectUri) {
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    "&response_type=code&scope=email+profile&state=probe";
  try {
    const res = await fetch(url, { redirect: "follow" });
    const body = await res.text();
    if (/redirect_uri_mismatch/i.test(body)) return false;
    return res.ok;
  } catch {
    return false;
  }
}

export async function mintGoogleAuth(email, existing = {}, context = {}) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("google oauth client not configured");

  const domain = process.env.ALLOWED_DOMAIN || "plumhq.com";
  const token = process.env.SUPABASE_MGMT_TOKEN;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const ref = context.supabase?.project_ref;
  if (!ref) throw new Error("supabase project not ready yet — google auth deferred");

  const payload = { ...existing };
  payload.callback_url = `https://${ref}.supabase.co/auth/v1/callback`;
  payload.client_id = clientId; // public by design; the secret never leaves the desk
  payload.hd = domain;

  if (!payload.configured) {
    const guard = await fetch(`${SUPABASE_API}/projects/${ref}/database/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: domainGuardSql(domain) }),
    });
    if (!guard.ok) {
      throw new Error(`domain guard install failed: ${guard.status} ${await guard.text()}`);
    }

    const appProject = context.vercel?.project_name;
    const allowList = ["http://localhost:3000/**", "http://localhost:5173/**"];
    if (appProject) allowList.push(`https://${appProject}*.vercel.app/**`);

    const config = {
      external_google_enabled: true,
      external_google_client_id: clientId,
      external_google_secret: clientSecret,
      hook_before_user_created_enabled: true,
      hook_before_user_created_uri:
        "pg-functions://postgres/public/insurwreck_restrict_signup_domain",
      uri_allow_list: allowList.join(","),
    };
    if (appProject) config.site_url = `https://${appProject}.vercel.app`;

    const res = await fetch(`${SUPABASE_API}/projects/${ref}/config/auth`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      throw new Error(`google auth config failed: ${res.status} ${await res.text()}`);
    }
    payload.configured = true;
    payload.redirect_allow_list = allowList;
    payload.domain_guard = "insurwreck_restrict_signup_domain";
    payload.sign_in_snippet =
      `await supabase.auth.signInWithOAuth({ provider: 'google', ` +
      `options: { queryParams: { hd: '${domain}' } } })`;
  }

  // Google has no API for authorized redirect URIs, so an organizer pastes
  // callbacks into the console. We detect that ourselves rather than trusting
  // manual bookkeeping, so the flag clears on its own once the paste happens.
  if (!payload.console_registered) {
    if (await callbackRegistered(clientId, payload.callback_url)) {
      payload.console_registered = true;
      payload.registered_at = new Date().toISOString();
    }
  }

  return finalize(payload, payload.console_registered ? [] : ["google_console_registration"]);
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

  // Every participant gets a `risks` table in their own project from day one,
  // so Claude Code always has somewhere to log a flagged export/download
  // request (see CLAUDE.md) without depending on build order. Mirrors the DDL
  // pattern mintGoogleAuth already uses against a participant's project.
  // Must never throw: a hiccup here can't cost someone their real Supabase
  // credentials, and the guard makes it free to retry on the next repair.
  if (payload.service_role_key && !payload.risks_table_ready) {
    const ddl = `
      create table if not exists public.risks (
        id uuid primary key default gen_random_uuid(),
        request_text text not null,
        created_at timestamptz not null default now()
      );
      alter table public.risks enable row level security;
    `;
    try {
      const res = await fetch(`${SUPABASE_API}/projects/${payload.project_ref}/database/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: ddl }),
      });
      if (res.ok) {
        payload.risks_table_ready = true;
      } else {
        console.error(`risks table create failed for ${email}: ${res.status} ${await res.text()}`);
      }
    } catch (error) {
      console.error(`risks table create failed for ${email}:`, error.message);
    }
  }

  const pending = [];
  if (!payload.service_role_key) pending.push("api_keys");
  if (!payload.risks_table_ready) pending.push("risks_table");
  return finalize(payload, pending);
}

// ------------------------------------------------------------- agentmail ---

// AgentMail has no per-inbox API key: POST /v0/api-keys scopes by permission,
// not by inbox. So every participant shares one org key (kept to the minimum
// permission set) and gets their own inbox under it. `client_id` is the
// idempotency handle — re-provisioning returns the same inbox, never a second.
export async function mintAgentmail(email, existing = {}) {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error("AGENTMAIL_API_KEY not set");

  const payload = { ...existing };
  const slug = slugFor(email);
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  // The account is capped at 10 inboxes and the cap cannot be raised, which is
  // fewer than the room. AgentMail honours plus-addressing - verified: mail to
  // <base>+tag@agentmail.to lands in <base> with the tagged address preserved
  // in `to` - so one shared inbox serves everyone and each participant filters
  // their own mail on that field. Set AGENTMAIL_SHARED_INBOX to switch this on;
  // unset, it falls back to creating an inbox per person.
  const shared = process.env.AGENTMAIL_SHARED_INBOX;
  if (shared && !payload.inbox_id) {
    const [base, domain] = shared.split("@");
    payload.inbox_id = shared;
    payload.address = `${base}+${slug}@${domain}`;
    payload.shared_inbox = true;
    payload.api_key = key;
    payload.api_base = AGENTMAIL_API;
    payload.note =
      `Your address is ${base}+${slug}@${domain}. Everyone shares one inbox, so ` +
      `filter on the "to" field for your own tag - listing messages returns the ` +
      `whole room's mail. Send with "from" set to your tagged address: ` +
      `POST {api_base}/inboxes/${shared}/messages/send`;
    return finalize(payload, []);
  }

  if (!payload.inbox_id) {
    const res = await fetch(`${AGENTMAIL_API}/inboxes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        username: slug,
        client_id: slug,
        display_name: `Insurwreck · ${email.split("@")[0]}`,
        // Omitted -> AgentMail's default agentmail.to. Set once the custom
        // domain shows VERIFIED; an unverified domain fails the create call.
        ...(process.env.AGENTMAIL_DOMAIN ? { domain: process.env.AGENTMAIL_DOMAIN } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`agentmail inbox create failed: ${res.status} ${JSON.stringify(data)}`);
    }
    payload.inbox_id = data.inbox_id;
    payload.address = data.email;
    payload.api_key = key;
    payload.api_base = AGENTMAIL_API;
    payload.note =
      "Shared hackathon key, your own inbox. Send: POST {api_base}/inboxes/{inbox_id}/messages/send";
  }

  return finalize(payload, payload.inbox_id ? [] : ["inbox"]);
}

// ------------------------------------------------------------- anthropic ---

// Anthropic's Admin API cannot create API keys — "new API keys can only be
// created through the Claude Console for security reasons". So instead of a
// real key, each participant gets a proxy token for the desk's /api/llm
// endpoint, which holds the one real key and meters usage per participant.
//
// The token is a drop-in for the Anthropic SDK: point baseURL at api_base and
// pass the token as the API key. Nothing else in their code changes.
export async function mintAnthropic(email, existing = {}) {
  const payload = { ...existing };

  if (!payload.api_key) {
    const token = `iwk-${randomBytes(24).toString("base64url")}`;
    payload.api_key = token;
    payload.token_hash = createHash("sha256").update(token).digest("hex");
    payload.api_base = `${deskBaseUrl()}/api/llm`;
    payload.models = ["claude-sonnet-5", "claude-opus-5"];
    payload.budget_usd = Number(process.env.LLM_BUDGET_USD || 15);
    payload.note =
      "Use with the Anthropic SDK: new Anthropic({ apiKey, baseURL: api_base }). Metered per participant.";
  }

  return finalize(payload, []);
}

// ------------------------------------------------------------------ n8n ---

// n8n is a shared, organizer-hosted instance rather than one per participant,
// so there is nothing to create - the "mint" just hands out the shared endpoint
// and token. Doing it here beats hand-inserting 25 credentials rows, and means
// /insurwreck:status repairs it automatically once the env var is set.
export async function mintN8n(email, existing = {}) {
  const token = process.env.N8N_TOKEN;
  if (!token) throw new Error("N8N_TOKEN not set");

  const payload = { ...existing };
  payload.token = token;
  payload.mcp_url =
    process.env.N8N_MCP_URL || "https://workflow-stg.plumhq.com/mcp-server/http";
  payload.shared = true;
  payload.workflow_prefix = slugFor(email);
  payload.note =
    "Shared hackathon n8n, reachable as the `n8n` MCP server in Claude Code. Everyone writes to the same " +
    "workspace, so name every workflow with your workflow_prefix and never edit one that isn't yours.";
  return finalize(payload, []);
}

// ----------------------------------------------------------------- kula ---

// Kula authenticates the MCP server with an API key and nothing else - there is
// no OAuth flow and no email/password login, so unlike Keka this CANNOT be
// scoped to the individual participant. One organizer-generated key is handed to
// everyone, exactly like n8n.
//
// Read this before switching it on: Kula's own docs classify the Application API
// key as "Full access", and the MCP server exposes 11 write tools including
// create_candidate, update_candidate and update_application_stage. So this key
// lets any participant read the whole recruiting pipeline - real candidate PII -
// and move real applications between stages. Point KULA_API_KEY at a sandbox or
// demo workspace, not production, unless an organizer has decided otherwise.
export async function mintKula(email, existing = {}) {
  const token = process.env.KULA_API_KEY;
  if (!token) throw new Error("KULA_API_KEY not set");

  const payload = { ...existing };
  payload.api_key = token;
  payload.shared = true;
  payload.scoped_to_you = false;
  payload.note =
    "Shared hackathon Kula key, reachable as the `kula` MCP server in Claude Code. It is NOT scoped to you - " +
    "everyone sees the same candidates and the write tools change real records. Read freely, and check with an " +
    "organizer before you create or move anything.";
  return finalize(payload, []);
}

// --------------------------------------------------------------- zendesk ---

// Same shape as kula and for the same reason: Zendesk API tokens authenticate
// an account, not a person, so one organizer-issued token goes to everyone.
// Unlike kula it needs three values - the token alone is useless without the
// subdomain it belongs to and the agent email it authenticates as.
//
// Read this before switching it on: this points at a real support desk with
// real customer tickets, and zd-mcp-server exposes zendesk_add_public_note,
// which posts a reply the requester receives by email. block-zendesk-writes.sh
// denies every write tool for exactly that reason. Point ZENDESK_SUBDOMAIN at a
// sandbox if you have one; the hook stays on either way.
export async function mintZendesk(email, existing = {}) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const agentEmail = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_TOKEN;
  if (!subdomain || !agentEmail || !token) {
    throw new Error("ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_TOKEN not all set");
  }

  const payload = { ...existing };
  payload.subdomain = subdomain;
  payload.agent_email = agentEmail;
  payload.api_token = token;
  payload.shared = true;
  payload.scoped_to_you = false;
  payload.note =
    "Shared hackathon Zendesk credentials, reachable as the `zendesk` MCP server in Claude Code. Read-only - " +
    "the ticket data is real customer support traffic, and the write tools would reply to actual customers, " +
    "so they are blocked. Search and read freely; persist anything you generate in your own Supabase.";
  return finalize(payload, []);
}

// ------------------------------------------------------------- clevertap ---

// Third in the shared-credential family, and the sharpest of the three.
// CleverTap's REST API authenticates with an Account ID + Passcode pair that
// belongs to the ACCOUNT, not a person - there is no OAuth, no per-user key,
// and no read-only passcode type. So the one organizer-issued pair would have to
// go to every participant, exactly like kula and zendesk. It does not: this is the
// only service gated to an explicit email allowlist (CLEVERTAP_EMAILS), because it
// is the only one whose blast radius is messages to real members.
//
// Read this before switching it on: the passcode this delivers has full write
// access to a live engagement platform. clevertap-mcp exposes
// clevertap_create_campaign, which posts /targets/create.json with when:"now"
// across push, email, SMS, webpush, in-app and webhook - one tool call sends
// real messages to real Plum members, and there is no recall. It also exposes
// clevertap_delete_profile and clevertap_request (arbitrary path + method,
// including DELETE). block-clevertap-writes.sh denies every one of them and is
// the only control that exists, because CleverTap gives us no scoped credential
// to fall back on. Point CLEVERTAP_ACCOUNT_ID at a non-production project if
// one exists; the hook stays on either way.
// Who may hold the CleverTap credential at all. Default deny: unset means nobody,
// because the alternative is a forgotten config silently handing a production
// engagement passcode to 25 people. Comma-separated, same shape as ALLOWED_EMAILS.
//
// This is a DELIVERY gate, not an API scope - CleverTap has no per-user credential
// to scope to, which is exactly why the gate has to live here. A blocked
// participant gets no clevertap entry in their bundle, so iw-connect never writes
// the CLEVERTAP_* variables, the placeholders never resolve, and the server does
// not start on their machine. Nothing to block, nothing to explain.
//
// It does NOT revoke. Removing someone stops future mints; they keep whatever is
// already in their ~/.claude/settings.json. Taking it back means revoking their
// credentials row AND clearing those three keys on their machine.
export function clevertapAllowed(email) {
  const allowed = (process.env.CLEVERTAP_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowed.includes(String(email || "").trim().toLowerCase());
}

export async function mintClevertap(email, existing = {}) {
  if (!clevertapAllowed(email)) {
    // Expected outcome for most participants, not a misconfiguration.
    // provision.js logs every mint failure and leaves the service pending.
    throw new Error(`clevertap not enabled for ${email} (not in CLEVERTAP_EMAILS)`);
  }

  const accountId = process.env.CLEVERTAP_ACCOUNT_ID;
  const passcode = process.env.CLEVERTAP_PASSCODE;
  const region = process.env.CLEVERTAP_REGION || "in1";
  if (!accountId || !passcode) {
    throw new Error("CLEVERTAP_ACCOUNT_ID and CLEVERTAP_PASSCODE not both set");
  }

  const payload = { ...existing };
  payload.account_id = accountId;
  payload.passcode = passcode;
  payload.region = region;
  payload.shared = true;
  payload.scoped_to_you = false;
  payload.note =
    "Shared hackathon CleverTap credentials, reachable as the `clevertap` MCP server in Claude Code. Read-only - " +
    "every write tool is blocked, because this is a live engagement account and a campaign here would send real " +
    "push, email and SMS to real members. Read the analytics freely; write anything you generate to your own Supabase.";
  return finalize(payload, []);
}

function deskBaseUrl() {
  return (
    process.env.DESK_BASE_URL || "https://insurwreck-desk.preview.plumhq.com"
  ).replace(/\/+$/, "");
}
