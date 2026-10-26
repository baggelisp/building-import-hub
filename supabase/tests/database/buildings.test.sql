-- Database-level guarantees for public.buildings. Run with `supabase test db` against a local
-- stack that has applied every migration. Everything happens in one transaction that is rolled
-- back, so the tests leave no data behind.
begin;
select plan(22);

-- Two accounts. auth.uid() reads the `sub` claim, so switching claims switches the user.
insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-a000-00000000000a', 'alice@test.local', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-a000-00000000000b', 'bob@test.local', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- 1. Privileges ---------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.buildings'::regclass), 'RLS is enabled');
select table_privs_are('public', 'buildings', 'anon', array[]::text[], 'anon has no privileges at all');
select table_privs_are('public', 'buildings', 'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'authenticated has only the row operations that RLS governs');

-- A table created later by a migration must not be reachable by anon unless granted on purpose.
create table public.zz_probe (id int);
select table_privs_are('public', 'zz_probe', 'anon', array[]::text[], 'new tables give anon nothing by default');
drop table public.zz_probe;

-- 2. Isolation between users --------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-4000-a000-00000000000a');
insert into public.buildings (name, city) values ('Alice HQ', 'Athens');
select is((select count(*)::int from public.buildings), 1, 'alice sees her row');
select is((select user_id from public.buildings limit 1), '00000000-0000-4000-a000-00000000000a'::uuid,
  'user_id defaults to the caller');

select pg_temp.act_as('00000000-0000-4000-a000-00000000000b');
select is((select count(*)::int from public.buildings), 0, 'bob cannot see alice''s rows');
update public.buildings set name = 'Taken over' where name = 'Alice HQ';
delete from public.buildings where name = 'Alice HQ';
select pg_temp.act_as('00000000-0000-4000-a000-00000000000a');
select is((select name from public.buildings limit 1), 'Alice HQ', 'bob''s update and delete touched nothing');

select pg_temp.act_as('00000000-0000-4000-a000-00000000000b');
select throws_ok(
  $$ insert into public.buildings (name, user_id) values ('Planted', '00000000-0000-4000-a000-00000000000a') $$,
  '42501', null, 'bob cannot create rows owned by alice');

select pg_temp.act_as('00000000-0000-4000-a000-00000000000a');
select throws_ok(
  $$ update public.buildings set user_id = '00000000-0000-4000-a000-00000000000b' where name = 'Alice HQ' $$,
  '42501', null, 'alice cannot hand her row to bob');

-- 3. Duplicates ---------------------------------------------------------------------------------
select is((select dedupe_key from public.buildings where name = 'Alice HQ'), 'alice hq||athens',
  'dedupe_key matches dedupeKey() in the shared TypeScript module');
select throws_ok(
  $$ insert into public.buildings (name, city) values ('  alice   HQ ', 'ATHENS') $$,
  '23505', null, 'same building with different case and spacing is rejected');
select lives_ok(
  $$ insert into public.buildings (name, city) values ('Alice HQ', 'Patras') $$,
  'same name in another city is a different building');
insert into public.buildings (name, city) values ('alice hq', 'athens')
  on conflict (user_id, dedupe_key) do nothing;
select is((select count(*)::int from public.buildings where dedupe_key = 'alice hq||athens'), 1,
  'ON CONFLICT DO NOTHING (the import''s insert) skips the duplicate');

select pg_temp.act_as('00000000-0000-4000-a000-00000000000b');
select lives_ok($$ insert into public.buildings (name, city) values ('Alice HQ', 'Athens') $$,
  'another user may own a building with the same identity');

-- 4. Value rules --------------------------------------------------------------------------------
select throws_ok($$ insert into public.buildings (name) values ('   ') $$, '23514', null, 'blank name is rejected');
select throws_ok($$ insert into public.buildings (name) values (repeat('x', 201)) $$, '23514', null,
  'name longer than 200 characters is rejected');
select throws_ok($$ insert into public.buildings (name, floors) values ('Pit', -1) $$, '23514', null,
  'negative floors are rejected');
select throws_ok($$ insert into public.buildings (name, year_built) values ('Future', 2101) $$, '23514', null,
  'year built after 2100 is rejected');
select lives_ok($$ insert into public.buildings (name, floors, year_built) values ('Edge', 0, 1000) $$,
  'boundary values are accepted');

-- 5. Account removal ----------------------------------------------------------------------------
reset role;
select is((select count(*)::int from public.buildings where user_id = '00000000-0000-4000-a000-00000000000b'), 2,
  'bob has two buildings before his account is removed');
delete from auth.users where id = '00000000-0000-4000-a000-00000000000b';
select is((select count(*)::int from public.buildings where user_id = '00000000-0000-4000-a000-00000000000b'), 0,
  'removing an account removes its buildings');

select * from finish();
rollback;
