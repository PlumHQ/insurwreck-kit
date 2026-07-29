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

alter table public.participants enable row level security;
alter table public.otp_codes enable row level security;
alter table public.sessions enable row level security;
alter table public.credentials enable row level security;
