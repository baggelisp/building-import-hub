# Building Import Hub — how it was deployed, and why

Vangelis Spathonis · 26 October 2026

- **Live app:** https://rcg-project-c18f5.web.app
- **Repository:** https://github.com/baggelisp/building-import-hub
- **Reviewer account:** `thomas.katsikadakos@redataset.com`. The password is sent separately.

Everything runs on free tiers: Firebase Hosting on the Spark plan and a Supabase free project.
No payment details were entered anywhere.

## 1. Does this app need SSR?

No. Four reasons:

- **Nothing to index.** Every page except the sign-in form sits behind authentication, so a
  crawler would only ever see the login screen.
- **No secrets to keep server-side.** The browser holds the user's Supabase session, and
  Postgres row-level security decides what each request may read or write. A render server
  would add nothing to security.
- **No real speed gain.** The data the page needs is the user's own list of buildings. It has
  to be fetched with the user's token either way, so server rendering would only move that
  fetch, not remove it.
- **SSR was already switched off.** The repository had `defaultSsr: false`.

That last point was misleading. The flag stops pages from rendering on a server, but the build
still produced a server: the Lovable Vite preset bundled a Nitro worker (Cloudflare target), and
the Excel upload handler was a TanStack `createServerFn`, which needs that worker at runtime. A static
host would serve the pages and then fail on the first import.

So "removing SSR" meant two concrete changes:

1. **Build as a static SPA.** I replaced the preset with an explicit Vite config that turns on
   TanStack Start's SPA mode and deleted the server entry, the request middleware and the
   Lovable runtime files. `npm run build` now emits `dist/client`: one prerendered `index.html`
   plus hashed assets. Firebase rewrites every path to that file.
2. **Move the import into Supabase.** It became the Edge Function `import-buildings`. The
   original prompt quoted in the README had asked for exactly that; the generated code had put
   it in a server function instead.

## 2. Deployment choices

**Frontend: Firebase Hosting.**

- `firebase.json` rewrites all routes to the shell, so `/buildings` survives a refresh.
- HTML is served with `no-cache` and hashed assets with a one-year immutable cache, so a deploy
  shows up immediately.
- Clickjacking, MIME-sniffing, referrer, permissions and HSTS headers are set.
- A post-build script writes a Content-Security-Policy into the page. It hashes the inline
  bootstrap scripts of that particular build, so scripts never need `unsafe-inline`.

**Backend: a Supabase free project** in eu-west-1, managed only through files in the repository.

_Schema._ `supabase/migrations` is applied with `supabase db push`. A new migration hardens the
original table:

- It revokes the privileges Supabase grants `anon` by default.
- It adds CHECK constraints that mirror the import's validation.
- It adds a cascading foreign key to `auth.users`.
- It adds a generated `dedupe_key` column with a per-user unique constraint, so duplicate
  buildings are impossible at the database level, not just discouraged by the UI.
- The RLS policies call `auth.uid()` once per query, and UPDATE can no longer reassign a row to
  another user.

_Import function._ The Edge Function verifies the caller's JWT itself (`auth.getClaims`), then
works with the caller's token, so RLS applies to every insert. It has two modes:

- `preview` parses the file and reports exactly what an import would do. It writes nothing.
- `commit` parses the file again with the column mapping the user confirmed and inserts every
  valid row in a single `INSERT … ON CONFLICT DO NOTHING`.

The browser never sends parsed rows, only the file. What gets stored is always decided on the
server.

_Auth._

- Public sign-up is disabled in the Supabase settings and removed from the UI.
- Passwords must be at least 12 characters.
- The site URL and redirect list point at the Firebase domain.
- Accounts are created with `scripts/provision-user.mjs`. It generates the password, checks
  that the new account can actually sign in with the public key, and writes the password to an
  owner-only file instead of printing it. Thomas's account was created this way.

**Integration.**

- The frontend gets the project URL and the publishable key at build time (`VITE_*`). Both are
  public by design.
- The secret key is never shipped. CI fails the build if a key of that shape appears in the
  bundle.
- The `.env` committed in the original repository pointed at Lovable's backend. I removed it
  and added `.env.example` in its place.

**Automation.**

- Every pull request triggers `ci.yml`:
  - format, lint and type checks;
  - unit tests;
  - the Edge Function's `deno check`/`lint`;
  - the vendored-library checksum;
  - all migrations on an empty Postgres plus the pgTAP suite;
  - Playwright against the Firebase emulator.
- `deploy.yml` runs CI on `main`, then deploys in a fixed order: migrations, Edge Function,
  site, and finally a few HTTP probes of the live URL (headers, CSP, 401 for anonymous import calls).

## 3. Beyond getting it running

The brief was a deployment, but the import is the heart of this app. Real spreadsheets rarely
match a template, so I spent the remaining effort there.

**Import with review.** Nothing is saved until the user confirms. Before that, the dialog shows:

- how each column will be used and why: exact match, a synonym, AI, or the user's own choice;
- how many rows will be imported;
- which rows will be skipped, with the Excel row number and the reason;
- which rows duplicate an earlier row or an existing building.

Changing a column's target re-validates the file on the server.

**Files as they really look.**

- The header row is detected, so a title line or blank rows above the table don't break the
  import.
- Columns match by exact name first, then by English and Greek synonyms ("Storeys", "Year of
  construction", "Πόλη", "Έτος κατασκευής").
- Numbers typed as text and stray whitespace are cleaned up.

**AI column mapping, built to fail safe.** Headers that no rule recognises can go to Claude
(`claude-opus-5-5`, low effort):

- Only the header row and five sample rows, each cell cut to 60 characters, leave the server.
- The answer is constrained by a JSON schema generated for that request, so the model can only
  name real columns and real fields.
- The answer is then re-validated in code. Columns the rules already placed cannot be remapped,
  fields that are already taken are refused, and when two columns claim one field, the more
  confident one wins.
- Low-confidence guesses are shown as suggestions, not applied.
- Cell contents are treated as data, which guards against prompt injection.
- If there is no key, the call times out, or the model declines, the import continues without
  AI and the user maps the remaining columns by hand.

**The AI step is off in the deployed app.** The brief requires free tiers only, and the
Anthropic API is paid, so I did not configure a key. Setting the `ANTHROPIC_API_KEY` secret on
the function turns it on with no code change.

The repository includes an offline eval (`import-buildings/evals`). It has ten cases:
abbreviations, columns that only their values can identify, Greek and German headers,
misspellings, irrelevant columns, a field that is already taken, and a prompt-injection cell.
It scores _wrong_ answers (a field applied incorrectly) separately from _missed_ ones (left for
the user), because only the first silently damages data. Because of the key, it has not been
run against the live model yet.

**Everyday operations.** The table supports search, sorting, inline editing (with the same
validation as the import), single and bulk delete with confirmation, and an Excel export that
uses the template's columns, so an export can be re-imported.

## 4. Problems I hit and how I solved them

**The server function and the static host.** Covered in section 1. The flag said "no SSR", but
the build and the import still needed a server.

**Dependencies came from a private registry.** `bun.lock` resolved every package from Lovable's
own npm mirror. I switched to npm with the public registry. npm 10 then crashed while resolving
the tree (`Cannot read properties of null (reading 'edgesOut')`); npm 11 installs it cleanly, so
the lockfile is npm 11's and CI pins that version.

**SheetJS.** The npm registry stops at `xlsx` 0.18.5, which has two published advisories
(prototype pollution and ReDoS when parsing crafted files). That matters for an endpoint that
parses untrusted uploads. The web app installs 0.20.3 from the official SheetJS tarball. The
Edge Function imports a checked-in, checksummed copy of the same file, so every deploy bundles
identical bytes without depending on a third-party CDN.

**Failures the tests caught before any user did.** Every Playwright test fails on an uncaught
error or a CSP violation. That rule found two problems I would otherwise have shipped:

- _Hydration errors (React #520/#422)._ The shell is prerendered once at `/` but served for
  every path. Any route that set its own `<head>` or rendered its page during hydration
  produced HTML that did not match the shell. Fix: one static head for every route, and pages
  rendered inside `<ClientOnly>`. In a client-only app, that states the architecture in code.
- _A CSP hash that never matched._ TanStack's inline hydration script contains a NUL
  character. Browsers replace it with U+FFFD before hashing, so hashing the raw file bytes gave
  the wrong value. The CSP script now hashes what the browser actually hashes.

**A product bug the tests caught.** The e2e file has a title row above the table, and the
importer took that title as the header. Header detection now picks the first row that is at
least half as full as the widest row near the top, and it has unit tests.

**Default privileges.** I wanted the hardening migration to be based on evidence, not
assumption. I applied only the original migration to an empty local database and listed the
grants: `anon` held every table privilege, including `TRUNCATE`, which RLS does not filter.
PostgREST exposes no TRUNCATE endpoint, so this was not exploitable through the API, but least
privilege should not rest on that. The migration removes it and changes the default for future
tables. pgTAP tests now pin both.

**Caching rules.** In the emulator, the first version of the headers config served hashed
assets as `no-cache` and the root URL with no caching header at all. Firebase glob matching did
not combine the way I expected. A single regex rule for HTML paths fixed it, and the e2e suite
now checks the headers.

**Smaller ones.**

- The local Supabase stack collided with another project on the default ports, so this
  project's `config.toml` uses its own ports.
- Moving the emulator to a new port broke the Edge Function's CORS allow-list. The e2e run
  caught it immediately.

## 5. Verification and what I would do next

At the time of writing:

- 30 unit tests pass.
- 22 pgTAP assertions pass on a fresh database.
- 12 Playwright scenarios pass, both against the emulator and against the live URL, using a
  dedicated test account (never the reviewer's).

With more time I would:

- run the AI eval across several repetitions and tune the prompt against it;
- add a staging project so migrations meet real data before production;
- turn on point-in-time backups, which the free tier lacks;
- let users reset their own password, which needs an email provider beyond the free tier's test sender;
- add per-account rate limits on the import endpoint.
