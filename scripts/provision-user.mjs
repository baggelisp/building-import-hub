// Account provisioning for a deployment where self-service sign-up is switched off.
//
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... [SUPABASE_PUBLISHABLE_KEY=...] \
//     node scripts/provision-user.mjs person@example.com ./person.credentials
//
// What it does, in order:
//   1. generates a password locally: 100 random bits as lowercase base32 in dash-separated groups
//      ("k7q2m-…"), easy to read out or retype (the only digits are 2–7, so no 0/O or 1/l mix-ups);
//   2. creates the user through the Auth admin API, already confirmed, so no email is needed;
//   3. if a publishable key is given, signs in with it the way the browser does, to prove the
//      account really works before anyone is told it exists;
//   4. saves email + password to the given file with owner-only permissions.
// Nothing secret is echoed: CI logs and shell history only ever show the email and the user id.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, credentialsFile] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!email || !credentialsFile || !url || !secretKey) {
  console.error(
    "usage: SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/provision-user.mjs <email> <file>",
  );
  process.exit(2);
}

// RFC 4648 base32, lowercased. 20 symbols × 5 bits = 100 bits; each symbol uses exactly 5 bits of
// randomness, so there is no modulo bias.
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const bits = [...randomBytes(13)].map((b) => b.toString(2).padStart(8, "0")).join("");
const symbols = Array.from(
  { length: 20 },
  (_, i) => BASE32[parseInt(bits.slice(i * 5, i * 5 + 5), 2)],
);
const password = [0, 5, 10, 15].map((i) => symbols.slice(i, i + 5).join("")).join("-");

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  console.error(`createUser(${email}) failed: ${created.error.message}`);
  process.exit(1);
}

let verified = false;
if (publishableKey) {
  const browserLike = createClient(url, publishableKey, { auth: { persistSession: false } });
  const login = await browserLike.auth.signInWithPassword({ email, password });
  if (login.error) {
    console.error(`${email} was created but cannot sign in: ${login.error.message}`);
    process.exit(1);
  }
  verified = true;
}

writeFileSync(credentialsFile, `email: ${email}\npassword: ${password}\n`, { mode: 0o600 });
console.log(
  `${email} → user ${created.data.user.id}${verified ? " (login checked)" : ""}; credentials in ${credentialsFile}`,
);
