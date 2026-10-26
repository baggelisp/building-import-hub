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
| `.github/workflows/`                   | `ci.yml` (all checks on every PR) and `deploy.yml` (main → production)                                                                                                     |

## Run it locally

Requirements: Node 22 with npm 11 (`npm i -g npm@11`), and for database tests Docker plus the
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

| Command                                                                        | Covers                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                     | Vitest: domain rules, header detection, AI-output validation                                                                                                                                                                                                                                 |
| `npm run test:e2e`                                                             | Playwright: routing, auth, import flow, edit, delete, export, CSP violations. Signed-in tests need `TEST_ACCOUNT_EMAIL`/`TEST_ACCOUNT_PASSWORD` for a throwaway account (its buildings are deleted), plus the two `VITE_*` values. `APP_URL=https://… npm run test:e2e` targets a deployment |
| `supabase db start && supabase test db`                                        | pgTAP: privileges, per-user isolation, dedupe constraint, value constraints, cascade                                                                                                                                                                                                         |
| `cd supabase/functions && deno check import-buildings/index.ts && deno lint`   | Edge Function types and lint                                                                                                                                                                                                                                                                 |
| `deno run -A import-buildings/evals/mapping.eval.ts` (in `supabase/functions`) | AI mapping eval; needs `ANTHROPIC_API_KEY` and costs a few cents                                                                                                                                                                                                                             |

## Deploy

`deploy.yml` deploys every push to `main` after CI passes: migrations, Edge Function, site, then a
smoke test. It needs, in the `production` environment:

| Kind              | Name                                                 | Value                                                     |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| secret            | `SUPABASE_ACCESS_TOKEN`                              | Supabase personal access token                            |
| secret            | `FIREBASE_SERVICE_ACCOUNT`                           | JSON key of a service account with Firebase Hosting Admin |
| variable          | `SUPABASE_PROJECT_REF`, `FIREBASE_PROJECT_ID`        | project identifiers                                       |
| variable          | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | public client config                                      |
| secret (optional) | `TEST_ACCOUNT_EMAIL`, `TEST_ACCOUNT_PASSWORD`        | enables signed-in e2e in CI                               |

Manual equivalent:

```sh
supabase link --project-ref <ref> && supabase db push
supabase functions deploy import-buildings --use-api
npm run build && npx firebase deploy --only hosting
```

Edge Function settings (`supabase secrets set …`): `ALLOWED_ORIGINS` (comma-separated site
origins for CORS) and, to enable AI mapping, `ANTHROPIC_API_KEY`.

## Accounts

Sign-up is disabled. Create an account with:

```sh
SUPABASE_URL=… SUPABASE_SECRET_KEY=… SUPABASE_PUBLISHABLE_KEY=… \
  node scripts/provision-user.mjs person@example.com ./person.credentials
```

The password goes only into that file (mode 0600); send it separately and delete the file.
