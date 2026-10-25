# SheetJS Community Edition 0.20.3 (vendored)

`xlsx.mjs` is the unmodified ES module build from the official SheetJS distribution
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), Apache-2.0 licensed (see `LICENSE`).

Why vendored:

- The `xlsx` package on the npm registry stops at 0.18.5, which has known vulnerabilities
  (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS). SheetJS now publishes only on its own CDN.
- The Supabase Edge Function bundler refuses imports from `cdn.sheetjs.com`, so the function
  cannot import it by URL.

Verify: `shasum -a 256 -c SHA256SUMS` (the hash must match the file inside the official tarball,
which is also what `npm install` puts in `node_modules/xlsx/xlsx.mjs` for the web app).
