-- Reuse the insurwreck-desk project for Insurwreck 5.0 (150+ participants)
-- without last event's state leaking into it.
--
-- Run once, before onboarding opens. Applied via the Supabase Management API,
-- same as schema.sql. Every step is additive or archived-then-cleared, so the
-- only irreversible thing here would be losing llm_usage - which is why the
-- archive is verified before the delete rather than after.
--
-- What this fixes, all of which were silent:
--   1. /api/llm sums llm_usage per email with no event filter, so July's spend
--      counted against tomorrow's budget. Four people were already over the cap.
--   2. participants.provisioned_at was set for all 38, so the roster could not
--      tell who had actually onboarded for this event.
--   3. idea_brief was still July's, and idea-to-template reads it to open the
--      first conversation.
--
-- Credentials are deliberately NOT touched. Returning participants keep their
-- existing Supabase project and Vercel token; re-minting 38 people would cost
-- 38 new projects against the org quota and orphan the apps they already shipped.

begin;

-- 1 ---------------------------------------------------------------- archive
create table if not exists public.llm_usage_iw4 as
  select * from public.llm_usage;

-- Every other table in this schema is service-role-only. An archive of who
-- spent what, readable by the anon key, would be a worse leak than the table
-- it came from.
alter table public.llm_usage_iw4 enable row level security;

-- 2 ----------------------------------------------------------------- cohort
-- Additive and default-valued on purpose: no existing query names this column,
-- so nothing has to change to keep working, and anyone registering from now on
-- lands in iw5 without the desk doing anything.
alter table public.participants
  add column if not exists cohort text not null default 'iw5';

update public.participants
   set cohort = 'iw4'
 where created_at < '2026-08-01';

-- 3 ------------------------------------------------------------------ reset
-- Returning participants re-onboard as themselves: same email, same row, same
-- credentials, but nothing that makes the desk or their agent think they are
-- already set up for this event.
update public.participants
   set provisioned_at = null,
       idea_brief     = null
 where cohort = 'iw4';

-- 4 ------------------------------------------------------------ clear spend
-- Only after the archive above is known good. If the counts disagree the
-- transaction rolls back with the spend history still intact, which is the one
-- outcome here that could not be undone.
do $$
declare live_n bigint; arch_n bigint;
begin
  select count(*) into live_n from public.llm_usage;
  select count(*) into arch_n from public.llm_usage_iw4;
  if live_n = 0 then
    raise notice 'llm_usage already cleared (% rows archived) - nothing to do', arch_n;
    return;
  end if;
  if live_n <> arch_n then
    raise exception 'archive mismatch: llm_usage=% llm_usage_iw4=% - refusing to clear spend', live_n, arch_n;
  end if;
  delete from public.llm_usage;
end $$;

commit;
