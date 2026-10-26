# Vendored: SheetJS CE 0.20.3

`xlsx.mjs` and `types.d.ts` are byte-for-byte copies from the 0.20.3 tarball that SheetJS
publishes on its own CDN. The same tarball is what `package.json` installs for the web app, so
the browser and the Edge Function run one and the same parser. License: Apache-2.0 (`LICENSE`).

## Why a copy in the repository

1. **The npm registry is stuck on 0.18.5.** SheetJS stopped publishing to npm, and that last
   version has two published advisories (CVE-2023-30533, prototype pollution when reading crafted
   files; CVE-2024-22363, regular-expression denial of service). An upload endpoint that parses
   untrusted spreadsheets should not run it.
2. **Deploys should not depend on a third-party host.** A relative import of a checked-in,
   checksummed file bundles the same bytes on every deploy, offline or not, and a change to the
   parser shows up as a reviewable diff instead of a silent upstream swap.

## Checking the copy

```sh
shasum -a 256 -c SHA256SUMS          # run in this directory
shasum -a 256 ../../../../../node_modules/xlsx/xlsx.mjs   # must print the same hash
```

To upgrade: bump the tarball URL in `package.json`, `npm install`, copy `node_modules/xlsx/xlsx.mjs`
and `node_modules/xlsx/types/index.d.ts` here (as `types.d.ts`), and regenerate `SHA256SUMS`.
