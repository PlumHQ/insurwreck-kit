-- Insurwreck 4.0 credential desk schema.
-- Applied via the Supabase Management API; kept here as the source of truth.
-- All tables have RLS enabled with no policies: only the service role
-- (used by the desk API) can read or write. The anon key sees nothing.

create extension if not exists pgcrypto;

-- `cohort` exists because the desk is reused across events. Email is unique for
-- all time, so a returning participant is the same row, not a new one; the
-- column is what tells this event's people from the last one's. Default-valued
-- so no query has to name it and anyone registering now lands in the current
-- cohort automatically. See scripts/iw5-cohort-reset.sql.
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  idea_brief text,
  agent text,
  cohort text not null default 'iw5',
  -- The short name they pick during onboarding for their site; becomes
  -- <site_name>.insurwreck.com. Stored already sanitised to a DNS label, so what
  -- an organizer reads here is exactly what the URL reads. Nullable: no name yet
  -- falls back to the project slug rather than to a guess.
  site_name text,
  verified_at timestamptz,
  provisioned_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists otp_codes_email_idx
  on public.otp_codes (email, created_at desc);

create table if not exists public.sessions (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- One row per participant per service. Organizers pre-insert rows for
-- services that cannot be minted live (vercel, n8n, and initially supabase
-- and agentmail); the desk inserts rows it mints live (resend).
create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  participant_email text not null,
  service text not null,
  payload jsonb not null default '{}'::jsonb,
  minted_live boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (participant_email, service)
);

-- Model spend per participant, written by /api/llm on every call it relays.
-- Anthropic can't mint per-participant API keys, so the desk proxies the one
-- real key and meters here instead; the sum per participant is the budget check.
create table if not exists public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  participant_email text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists llm_usage_participant_idx
  on public.llm_usage (participant_email, created_at desc);

-- Which Metabase saved questions participants can reach through /api/mcp.
-- Lives in the database, not an env var, so an organizer can publish a new
-- slice during the event without redeploying the desk.
create table if not exists public.data_slices (
  card_id     integer primary key,
  name        text,
  note        text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A materialised copy of each published slice, refreshed from a machine that can
-- reach stats2. The desk runs on Vercel, whose egress is not on the warehouse
-- proxy's IP allowlist, so /api/mcp falls back to this when Metabase 403s.
-- Also means a stats2 outage mid-event doesn't take the data with it.
create table if not exists public.slice_cache (
  card_id     integer primary key,
  name        text,
  columns     jsonb not null default '[]'::jsonb,
  rows        jsonb not null default '[]'::jsonb,
  row_count   integer not null default 0,
  refreshed_at timestamptz not null default now()
);

-- One row per flagged "export/download this data" request, logged by a
-- participant's own Claude Code session (CLAUDE.md instructs it to, on the
-- honour system) so an organizer can review across everyone in one place.
-- Also written to the same-shaped `risks` table inside each participant's own
-- Supabase project — this one is just the shared, cross-participant view.
create table if not exists public.risks (
  id uuid primary key default gen_random_uuid(),
  participant_email text not null,
  request_text text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists risks_created_at_idx
  on public.risks (created_at desc);

alter table public.participants enable row level security;
alter table public.otp_codes enable row level security;
alter table public.sessions enable row level security;
alter table public.credentials enable row level security;
alter table public.llm_usage enable row level security;
alter table public.data_slices enable row level security;
alter table public.slice_cache enable row level security;
alter table public.risks enable row level security;
