# Agent notes

- The frontend is a static SPA (TanStack Start in SPA mode, see `vite.config.ts`) deployed to
  Firebase Hosting. There is no runtime server: do not add `createServerFn`, server routes or
  request middleware. Server-side logic belongs in Supabase (Postgres + RLS, Edge Functions).
- Pages render only in the browser (`<ClientOnly>` around the root `<Outlet />`). Keep the root
  `head` static: the prerendered shell is served for every path.
- The Excel import is the `import-buildings` Edge Function (`supabase/functions/import-buildings`).
  Domain rules shared by the function, the web app and the tests live in
  `supabase/functions/_shared/` (imported in the app as `@shared/*`); keep them dependency-free.
- Schema changes are SQL migrations in `supabase/migrations`, applied with `supabase db push`.
  Every table needs RLS, and `anon` gets no privileges unless a migration grants them.
- SheetJS is 0.20.3 from the official CDN tarball (npm stops at the vulnerable 0.18.5); the Edge
  Function uses the vendored copy in `_shared/vendor/xlsx-0.20.3`.
- This repository started as a Lovable project and is no longer connected to the Lovable editor.
  Avoid rewriting published git history (force pushes, amending pushed commits).
