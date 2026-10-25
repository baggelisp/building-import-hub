-- Hardening for public.buildings.

-- 1. Least privilege.
-- Supabase's default privileges grant anon and authenticated ALL on every new table in public,
-- so the GRANT in the first migration restricted nothing: RLS was the only barrier for anonymous
-- requests, and TRUNCATE is not covered by RLS at all.
revoke all on public.buildings from anon;
revoke truncate, references, trigger on public.buildings from authenticated;
-- Future tables in public: anon gets nothing unless a migration grants it explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- 2. Integrity: the same limits the import Edge Function enforces (supabase/functions/_shared/buildings.ts),
-- so a direct API call cannot store what the import would reject.
alter table public.buildings
  add constraint buildings_name_length check (char_length(btrim(name)) between 1 and 200),
  add constraint buildings_address_length check (char_length(address) <= 300),
  add constraint buildings_city_length check (char_length(city) <= 100),
  add constraint buildings_country_length check (char_length(country) <= 100),
  add constraint buildings_floors_range check (floors between 0 and 300),
  add constraint buildings_year_built_range check (year_built between 1000 and 2100);

-- Deleting a user deletes their buildings instead of leaving orphaned rows.
alter table public.buildings
  add constraint buildings_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;

-- 3. Duplicates are enforced by the database, not just detected by the import.
-- Identity = name + address + city, ignoring case and spacing. Mirrors dedupeKey() in
-- supabase/functions/_shared/buildings.ts. The import uses ON CONFLICT DO NOTHING on this key,
-- so two concurrent imports of the same file cannot create duplicates.
alter table public.buildings
  add column dedupe_key text generated always as (
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) || '|' ||
    lower(btrim(regexp_replace(coalesce(address, ''), '\s+', ' ', 'g'))) || '|' ||
    lower(btrim(regexp_replace(coalesce(city, ''), '\s+', ' ', 'g')))
  ) stored;
alter table public.buildings
  add constraint buildings_user_dedupe_key unique (user_id, dedupe_key);

-- The unique constraint's index leads with user_id, so the single-column index is redundant.
drop index if exists public.buildings_user_id_idx;
create index buildings_user_created_idx on public.buildings (user_id, created_at desc);

-- 4. Policies: evaluate auth.uid() once per statement instead of once per row
-- (Supabase advisor "auth_rls_initplan"), and stop UPDATE from moving a row to another user.
alter policy "Users read own buildings" on public.buildings
  using ((select auth.uid()) = user_id);
alter policy "Users insert own buildings" on public.buildings
  with check ((select auth.uid()) = user_id);
alter policy "Users update own buildings" on public.buildings
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy "Users delete own buildings" on public.buildings
  using ((select auth.uid()) = user_id);
