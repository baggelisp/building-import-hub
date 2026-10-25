// Creates a confirmed user with a generated password. Public sign-up is disabled, so this is how
// people get access. Run by an administrator; the secret key is passed in, never stored.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
//     node scripts/provision-user.mjs <email> <output-file>
//
// The password is written only to <output-file> (mode 0600) and never printed, so it stays out
// of terminal scrollback and CI logs. Send it through a separate channel, then delete the file.
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, outputFile] = process.argv.slice(2);
const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey } = process.env;
if (!email || !outputFile || !url || !secretKey) {
  console.error(
    "Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/provision-user.mjs <email> <file>",
  );
  process.exit(2);
}

// 20 characters from an alphabet without look-alikes (0/O, 1/l/I): about 115 bits of entropy.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const password = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // no confirmation email: the account works immediately
});
if (error) {
  console.error(`Could not create ${email}: ${error.message}`);
  process.exit(1);
}

// Prove the credentials work with the public key, exactly as the app signs in.
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (publicKey) {
  const client = createClient(url, publicKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    console.error(`Created ${email}, but signing in failed: ${signInError.message}`);
    process.exit(1);
  }
}

writeFileSync(outputFile, `email: ${email}\npassword: ${password}\n`, { mode: 0o600 });
console.log(
  `Created ${email} (id ${data.user.id})${publicKey ? ", sign-in verified" : ""}. Password written to ${outputFile}.`,
);
