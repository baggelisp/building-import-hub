-- Tighten public.buildings after reviewing what the first migration actually granted.
--
-- Finding: on Supabase, tables created by `postgres` in the public schema inherit default
-- privileges that give the API roles everything. Checked with
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'buildings';
-- anon (and authenticated) held SELECT/INSERT/UPDATE/DELETE plus TRUNCATE, REFERENCES and
-- TRIGGER. RLS filtered the row operations; TRUNCATE ignores RLS. PostgREST offers no TRUNCATE
-- endpoint, so this was not reachable through the API, but nothing should depend on that.

-- A. Privileges --------------------------------------------------------------------------------
-- Signed-out callers have no business with this table at all.
revoke all on public.buildings from anon;
-- Signed-in callers keep the four row operations that RLS governs, nothing else.
revoke truncate, references, trigger on public.buildings from authenticated;
-- Same rule for tables added later, so a new migration has to opt anon in deliberately.
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- B. Data rules --------------------------------------------------------------------------------
-- These repeat LIMITS in supabase/functions/_shared/buildings.ts. The import already rejects
-- such rows; the database repeats the check because PostgREST lets a signed-in user write to
-- the table directly, bypassing the Edge Function.
alter table public.buildings
  add constraint buildings_name_length check (char_length(btrim(name)) between 1 and 200),
  add constraint buildings_address_length check (char_length(address) <= 300),
  add constraint buildings_city_length check (char_length(city) <= 100),
  add constraint buildings_country_length check (char_length(country) <= 100),
  add constraint buildings_floors_range check (floors between 0 and 300),
  add constraint buildings_year_built_range check (year_built between 1000 and 2100);

-- user_id was a bare uuid. Tie it to the account so removing an account removes its data.
alter table public.buildings
  add constraint buildings_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;

-- C. One row per building per user -------------------------------------------------------------
-- A building is "the same" when name, address and city match after trimming, collapsing
-- whitespace and lowercasing; dedupeKey() in the shared module computes the identical string.
-- Storing it lets a unique constraint settle races (two tabs importing one file at once) that an
-- application-level check cannot, and the import inserts with ON CONFLICT DO NOTHING against it.
alter table public.buildings
  add column dedupe_key text generated always as (
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) || '|' ||
    lower(btrim(regexp_replace(coalesce(address, ''), '\s+', ' ', 'g'))) || '|' ||
    lower(btrim(regexp_replace(coalesce(city, ''), '\s+', ' ', 'g')))
  ) stored;
alter table public.buildings
  add constraint buildings_user_dedupe_key unique (user_id, dedupe_key);

-- The constraint's index starts with user_id, which makes the old user_id index redundant.
-- The list view sorts a user's rows by newest first, so index exactly that.
drop index if exists public.buildings_user_id_idx;
create index buildings_user_created_idx on public.buildings (user_id, created_at desc);

-- D. Policies ----------------------------------------------------------------------------------
-- Wrapping auth.uid() in a sub-select makes Postgres compute it once and reuse it, rather than
-- calling it for every row it checks. The UPDATE policy also gains a WITH CHECK: without one, a
-- user could change user_id on their own row and hand it to someone else.
alter policy "Users read own buildings" on public.buildings
  using ((select auth.uid()) = user_id);
alter policy "Users insert own buildings" on public.buildings
  with check ((select auth.uid()) = user_id);
alter policy "Users update own buildings" on public.buildings
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy "Users delete own buildings" on public.buildings
  using ((select auth.uid()) = user_id);
