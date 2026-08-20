-- Move credentials from per-person to per-idea for Insurwreck 5.0.
--
-- Run once, before onboarding opens, via the Supabase Management API (same as
-- schema.sql and iw5-cohort-reset.sql). Additive throughout: no existing row is
-- deleted, and every new column is nullable or default-valued, so the current
-- email-keyed path keeps working until provision.js is switched over.
--
-- WHY THIS EXISTS
--
-- 4.0 was one leader per idea, so `credentials(participant_email, service)` was
-- the natural key. 5.0 is org-wide: 60 published ideas, 136 people, teams of up
-- to 3 (9 solo, 5 pairs, 46 trios). Minting a Supabase project and a Vercel
-- project per person would be 136 of each where 60 will do - and worse, three
-- teammates on one idea would each get a different database and a different URL
-- while trying to build one app.
--
-- WHAT "THE 60" MEANS, EXACTLY
--
-- ideas.status = 'published' AND ideas.hidden = false. Nothing else. There are
-- 74 published rows; 14 are hidden. The 9 with idea_review_notes.skipped_at are
-- already inside that hidden set today, but that is a coincidence of the current
-- data and not a guarantee, so the refresh script filters on skipped_at too.
--
-- WHY A SNAPSHOT AND NOT A LIVE JOIN
--
-- The roster lives in a DIFFERENT Supabase project (the hub). Resolving an email
-- to an idea on every provision call would make onboarding for 136 people depend
-- on the hub being reachable at 9am on the day, which is the worst possible
-- moment to add a dependency. The roster is final - there is no confirmation step
-- coming - so a snapshot refreshed the night before is strictly safer. See
-- scripts/refresh-idea-teams.mjs.

begin;

-- 1 -------------------------------------------------------------- the roster

-- One row per (idea, member). Deliberately stores the member's EMAIL rather than
-- the hub's profile uuid: the desk identifies people by email everywhere else
-- (participants.email, credentials.participant_email, OTP), and carrying a
-- foreign key into another project's auth schema would be a fiction we could not
-- enforce.
create table if not exists public.idea_teams (
  idea_id uuid not null,
  member_email text not null,
  role text not null check (role in ('owner', 'member')),
  idea_title text not null,
  published_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (idea_id, member_email)
);

alter table public.idea_teams enable row level security;

-- The two lookups the resolver actually does: "which ideas is this email on?"
-- and "who captains this idea?".
create index if not exists idea_teams_member_email_idx
  on public.idea_teams (member_email);
create index if not exists idea_teams_owner_idx
  on public.idea_teams (idea_id) where role = 'owner';

-- 2 ------------------------------------------------------- resolved identity

-- Which idea's bundle belongs on this person's laptop. Set by the resolver on
-- first provision and then left alone, so the four people who have to be asked
-- (captains of several ideas, or members of several and captain of none) are
-- asked exactly once rather than every session.
alter table public.participants
  add column if not exists idea_id uuid;

-- 3 ---------------------------------------------------------- the credential

-- Nullable on purpose. A null idea_id means a solo bundle keyed to the email,
-- which is what organizers get - they are attending but on no published idea,
-- and they still need tooling to help people on the floor.
alter table public.credentials
  add column if not exists idea_id uuid;

-- THE IDEMPOTENCY GUARANTEE. Read this before changing it.
--
-- Today's `unique (participant_email, service)` is not just a tidiness
-- constraint - it is the only thing that stops a double provision from minting
-- two Supabase projects, and it works because each person only ever races
-- themselves. Re-keying to the idea removes that protection unless it is
-- rebuilt, and the failure is expensive and silent: two orphan projects nobody
-- knows exist, against an org quota.
--
-- So both modes get their own partial unique index, and provision.js claims a
-- row BEFORE calling any provider. The database is the lock.
-- Constraint FIRST, then the index. A unique CONSTRAINT owns its backing index,
-- and Postgres refuses to drop that index directly:
--
--   2BP01: cannot drop index credentials_participant_email_service_key because
--   constraint ... requires it
--
-- Dropping the constraint takes the index with it, so the second statement is a
-- no-op on a database where the constraint existed - and still does the right
-- thing on one where only a bare index was ever created.
alter table public.credentials
  drop constraint if exists credentials_participant_email_service_key;
drop index if exists public.credentials_participant_email_service_key;

create unique index if not exists credentials_idea_service_uidx
  on public.credentials (idea_id, service) where idea_id is not null;

create unique index if not exists credentials_email_service_uidx
  on public.credentials (participant_email, service) where idea_id is null;

create index if not exists credentials_idea_id_idx
  on public.credentials (idea_id) where idea_id is not null;

-- 4 ------------------------------------------------------------ the claim

-- A claimed-but-unminted row. provision.js inserts one of these to win the
-- right to call the provider, then patches the real payload over it.
--
-- claimed_at is what makes a crash recoverable: if the winner dies between the
-- insert and the patch, the row would otherwise wedge that idea's service
-- forever, and the only symptom would be one team whose Supabase never appears.
-- A claim older than the timeout may be retaken.
alter table public.credentials
  add column if not exists claimed_at timestamptz;

comment on column public.credentials.claimed_at is
  'Set when a provision claims the right to mint this (idea, service). Cleared '
  'when the payload lands. A claim older than ~90s is stale and may be retaken - '
  'see provision.js. Never null on a row whose payload is still empty.';

commit;

-- VERIFY (run after, expect: two partial unique indexes, no old constraint)
--
--   select indexname from pg_indexes
--    where tablename = 'credentials' and indexname like '%uidx';
--
--   select count(*) from public.idea_teams;   -- 0 until the refresh runs

-- ---------------------------------------------------------------------------
-- Applied separately as iw5_llm_usage_idea_id. Kept here so this file remains
-- the whole story of the 5.0 re-key.
--
-- The Anthropic key is one key per idea, so the budget has to be one pool per
-- idea. Summing spend by email would let each of three teammates spend the full
-- allowance off a single shared key - three times the intended cost, and
-- invisible until the invoice arrives.
--
-- participant_email stays, and stays meaningful as the CREDENTIAL HOLDER, but it
-- is not the caller: a team shares one key and the proxy has no way to tell
-- three teammates apart. Recording the holder and the idea is the truthful pair.
alter table public.llm_usage
  add column if not exists idea_id uuid;

-- The budget check runs on every single model call, so it gets its own index.
create index if not exists llm_usage_idea_id_idx
  on public.llm_usage (idea_id) where idea_id is not null;

-- ---------------------------------------------------------------------------
-- Applied separately as iw5_idea_teams_brief.
--
-- The brief comes from the hub, where the person who published the idea already
-- wrote it, instead of being asked again at onboarding. Asking produced a second
-- divergent answer - the half-remembered version typed at 9am - and that was the
-- one idea-to-template opened their first build conversation from.
--
-- Sourced from ideas.brief->>'summary', which is plain prose. The 'pitch' field
-- is HTML and is only a fallback.
alter table public.idea_teams
  add column if not exists idea_brief text;
