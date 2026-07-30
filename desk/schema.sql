-- Insurwreck 4.0 credential desk schema.
-- Applied via the Supabase Management API; kept here as the source of truth.
-- All tables have RLS enabled with no policies: only the service role
-- (used by the desk API) can read or write. The anon key sees nothing.

create extension if not exists pgcrypto;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  idea_brief text,
  agent text,
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

alter table public.participants enable row level security;
alter table public.otp_codes enable row level security;
alter table public.sessions enable row level security;
alter table public.credentials enable row level security;
alter table public.llm_usage enable row level security;
alter table public.data_slices enable row level security;
alter table public.slice_cache enable row level security;
