# Building Import Hub

A private buildings register: sign in, import buildings from any reasonably shaped Excel file,
review what will happen before anything is saved, then search, correct, delete and export.

**Live:** https://rcg-project-c18f5.web.app · **Write-up:** [WRITEUP.md](WRITEUP.md)

```
 Browser ─────────────── static files on Firebase Hosting (dist/client)
   │  supabase-js (publishable key + user JWT)
   ├──► Supabase Auth           email + password, sign-up disabled
   ├──► PostgREST → Postgres    buildings table, RLS per user, constraints, unique dedupe key
   └──► Edge Function import-buildings
          parse (SheetJS 0.20.3) → find header row → map columns
          (exact → synonyms → Claude, optional) → validate rows → preview | insert
```

There is no application server. The frontend is a TanStack Start app built in SPA mode; every
URL serves the same prerendered `index.html` and the router runs in the browser.

## Repository map

| Path                                   | What lives there                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                 | React app: routes, import wizard, table with inline edit                                                                                                                   |
| `supabase/functions/_shared/`          | Domain rules (fields, limits, header mapping, validation, dedupe key) and the AI-output validator. Dependency-free; used by the function, the app (`@shared/*`) and Vitest |
| `supabase/functions/import-buildings/` | The Edge Function: HTTP handling, workbook parsing, Claude call, and an offline eval (`evals/`)                                                                            |
| `supabase/migrations/`                 | Schema, privileges, RLS, constraints                                                                                                                                       |
| `supabase/tests/database/`             | pgTAP tests of the database guarantees                                                                                                                                     |
| `e2e/`                                 | Playwright tests, run against the Firebase emulator or a live URL                                                                                                          |
| `scripts/`                             | `add-csp.mjs` (post-build CSP), `provision-user.mjs` (create accounts)                                                                                                     |
| `.github/`                             | `ci.yml` (every PR, incl. a live preview), `deploy.yml` (main → production), `production-checks.yml` (synthetic monitor + drift), Dependabot                               |

## Run it locally

Requirements: Node 22 with npm 11.21+ (`npm i -g npm@11.21.0`), and for database tests Docker plus the
Supabase CLI.

```sh
npm ci
cp .env.example .env.local      # fill in the project URL and publishable key
npm run dev                     # http://localhost:8080
```

Production-like check (same rewrites and headers as Firebase):

```sh
npm run build && npm run serve:hosting   # http://localhost:5002
```

## Tests

| Command                                                                        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                     | Vitest: domain rules, header detection, AI-output validation                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run test:e2e`                                                             | Playwright: routing, auth, import flow, edit, delete, export, CSP violations. Signed-in tests need `TEST_ACCOUNT_EMAIL`/`TEST_ACCOUNT_PASSWORD` for a test account plus the two `VITE_*` values; each test touches only rows carrying its own random tag, so parallel runs on one account are safe. `--grep @smoke` is the subset used for release candidates and monitoring. `APP_URL=https://… npm run test:e2e` targets a deployment |
| `supabase db start && supabase test db`                                        | pgTAP: privileges, per-user isolation, dedupe constraint, value constraints, cascade                                                                                                                                                                                                                                                                                                                                                    |
| `cd supabase/functions && deno check import-buildings/index.ts && deno lint`   | Edge Function types and lint                                                                                                                                                                                                                                                                                                                                                                                                            |
| `deno run -A import-buildings/evals/mapping.eval.ts` (in `supabase/functions`) | AI mapping eval; needs `ANTHROPIC_API_KEY` and costs a few cents                                                                                                                                                                                                                                                                                                                                                                        |

## Delivery pipeline

```
pull request ─► CI: format · lint · types · unit · build (tarball) · secret scan
                    deno check/lint · SheetJS checksum · actionlint
                    migrations: applied ones immutable, new ones pass Squawk
                    all migrations on an empty Postgres + pgTAP
                    e2e on the Firebase emulator
                └► preview channel pr-<n> on real Hosting, full e2e there, URL commented on the PR
merge to main ─► same CI; the site tarball gets a build-provenance attestation
              └► release: verify attestation → migrations → Edge Function
                          → deploy to channel "candidate" → @smoke e2e on it
                          → release that exact version to live → live probes + @smoke
                          → on failure: previous live version restored automatically
every 6 h    ─► @smoke e2e against production (also keeps the free Supabase project awake)
nightly      ─► drift: migration history, `db diff` of the live schema, auth settings
                failures open one issue per check; a pass closes it
```

There are no long-lived cloud credentials for hosting. GitHub's OIDC token is exchanged through
a Workload Identity pool for a short-lived token of `github-deploy@…`, which has Hosting roles
only. The pool's provider accepts tokens from this repository's numeric id and nothing else.

| Kind     | Name                                                           | Where                           |
| -------- | -------------------------------------------------------------- | ------------------------------- |
| variable | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`           | repo (public client config)     |
| variable | `SUPABASE_PROJECT_REF`, `FIREBASE_PROJECT_ID`                  | repo                            |
| variable | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` | repo (identifiers, not secrets) |
| secret   | `TEST_ACCOUNT_EMAIL`, `TEST_ACCOUNT_PASSWORD`                  | repo (dedicated test user)      |
| secret   | `SUPABASE_ACCESS_TOKEN`                                        | `production` environment        |

Manual equivalent of a release:

```sh
supabase link --project-ref <ref> && supabase db push
supabase functions deploy import-buildings --use-api
npm run build && npm run deploy:hosting
```

Edge Function settings (`supabase secrets set …`): `ALLOWED_ORIGINS`, a comma-separated list
of origins where `*` matches inside one hostname label, so
`https://<site>--*.web.app` admits preview channels but nothing else. Setting
`ANTHROPIC_API_KEY` enables AI mapping.

## Accounts

Sign-up is disabled. Create an account with:

```sh
SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… \
  node scripts/provision-user.mjs person@example.com ./person.credentials
```

The password goes only into that file (mode 0600); send it separately and delete the file.
