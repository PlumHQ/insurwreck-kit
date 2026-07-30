-- Optional: run this against your own Supabase project (see credentials.json)
-- if you want the dashboard backed by a real table instead of the seed JSON.
-- Then flip the switch in lib/claims.ts and set SUPABASE_URL /
-- SUPABASE_SERVICE_ROLE_KEY in .env.local.

create table if not exists claims (
  id text primary key,
  member_name text not null,
  hospital text not null,
  amount numeric not null,
  status text not null check (status in ('Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid')),
  diagnosis text not null,
  created_at timestamptz not null default now()
);

alter table claims enable row level security;
-- No policies added — the app talks to Supabase with the service_role key
-- (server-side only), which bypasses RLS by design.
