import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { utils, write } from "xlsx";

export const E2E_EMAIL = process.env["E2E_EMAIL"] ?? "";
export const E2E_PASSWORD = process.env["E2E_PASSWORD"] ?? "";
export const hasAccount = E2E_EMAIL !== "" && E2E_PASSWORD !== "";

/** Deletes every building of the e2e account, through the API and RLS like any user would. */
export async function clearBuildings() {
  const url = process.env["VITE_SUPABASE_URL"];
  const key = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key)
    throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for e2e cleanup.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  });
  if (signInError) throw signInError;
  const { error } = await supabase.from("buildings").delete().not("id", "is", null);
  if (error) throw error;
  await supabase.auth.signOut();
}

/** An in-memory .xlsx built from rows, for setInputFiles. */
export function workbook(name: string, rows: unknown[][]) {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Sheet1");
  return {
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
  };
}

export async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Buildings", exact: true })).toBeVisible();
}

/** Fails the test on any uncaught error or CSP violation, so a too-strict policy cannot ship. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text()))
          problems.push(m.text());
      });
      await use();
      expect(problems, problems.join("\n")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
