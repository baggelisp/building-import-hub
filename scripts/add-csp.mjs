// Post-build: writes a Content-Security-Policy <meta> tag into dist/client/index.html.
//
// TanStack Start's prerendered shell carries small inline bootstrap scripts whose content can
// change between builds, so a hand-written policy would break silently. This script hashes the
// inline scripts actually present in this build and allows exactly those, so the policy needs
// no 'unsafe-inline' for scripts. frame-ancestors cannot be set from <meta>; firebase.json sends
// it (and the other security headers) as real HTTP headers.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";

const file = "dist/client/index.html";
const env = loadEnv(process.env.MODE ?? "production", process.cwd(), "VITE_");
const supabaseUrl = new URL(env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "");

let html = readFileSync(file, "utf8");
if (html.includes('http-equiv="Content-Security-Policy"')) {
  throw new Error(`${file} already has a CSP; run this once per build.`);
}

const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((body) => body.length > 0)
  // Hash what the browser hashes: the HTML parser turns NUL into U+FFFD and CRLF into LF
  // before CSP sees the script (TanStack's hydration payload can contain a NUL).
  .map((body) => body.replace(/\0/g, "\uFFFD").replace(/\r\n?/g, "\n"))
  .map((body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);

const policy = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(" ")}`,
  // Radix UI and sonner position elements with inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${supabaseUrl.origin} wss://${supabaseUrl.host}`,
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const charset = '<meta charSet="utf-8"/>';
if (!html.includes(charset)) throw new Error(`${file}: charset meta not found`);
html = html.replace(
  charset,
  `${charset}<meta http-equiv="Content-Security-Policy" content="${policy}"/>`,
);
writeFileSync(file, html);
console.log(
  `CSP written to ${file} (${hashes.length} inline script hashes, connect-src ${supabaseUrl.origin})`,
);
