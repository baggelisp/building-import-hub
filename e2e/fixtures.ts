import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { utils, write } from "xlsx";

export const ACCOUNT_EMAIL = process.env["TEST_ACCOUNT_EMAIL"] ?? "";
export const ACCOUNT_PASSWORD = process.env["TEST_ACCOUNT_PASSWORD"] ?? "";
export const hasAccount = ACCOUNT_EMAIL !== "" && ACCOUNT_PASSWORD !== "";

/**
 * Several pipelines (CI, PR previews, release candidates, the production monitor) share one test
 * account and may run at the same time. Each test therefore works only on rows whose name starts
 * with its own random tag, and removes exactly those rows afterwards.
 */
export function newTag() {
  return `t${Math.random().toString(36).slice(2, 8)}`;
}

export async function deleteTagged(tag: string) {
  const url = process.env["VITE_SUPABASE_URL"];
  const key = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key)
    throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for e2e cleanup.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: ACCOUNT_EMAIL,
    password: ACCOUNT_PASSWORD,
  });
  if (signInError) throw signInError;
  const { error } = await supabase.from("buildings").delete().ilike("name", `${tag} %`);
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
  await page.getByLabel("Email").fill(ACCOUNT_EMAIL);
  await page.getByLabel("Password").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Buildings", exact: true })).toBeVisible();
}

/** Rows of the buildings table that belong to this test (the search box filters by tag). */
export async function showOnly(page: Page, tag: string) {
  await page.getByLabel("Search buildings").fill(tag);
  return page.getByRole("row").filter({ hasText: tag });
}

/** Fails the test on any uncaught error or CSP violation, so a too-strict policy cannot ship. */
export const test = base.extend<{ consoleGuard: void; tag: string }>({
  // Signed-in tests use `tag`; its teardown removes whatever the test created.
  tag: async ({}, use) => {
    const tag = newTag();
    await use(tag);
    if (hasAccount) await deleteTagged(tag);
  },
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
