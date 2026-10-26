import { readFileSync } from "node:fs";
import { read, utils } from "xlsx";
import { expect, hasAccount, showOnly, signIn, test, workbook } from "./fixtures";

// Tests tagged @smoke also run against release candidates before promotion and against
// production on a schedule, so they must be quick and leave no trace.

test.describe("signed out", () => {
  test(
    "/ and /buildings bounce a signed-out visitor to /auth",
    { tag: "@smoke" },
    async ({ page }) => {
      await page.goto("/buildings");
      await expect(page).toHaveURL(/\/auth$/);
      await page.goto("/");
      await expect(page).toHaveURL(/\/auth$/);
    },
  );

  test(
    "deep links are served by the SPA shell, with security headers",
    { tag: "@smoke" },
    async ({ request }) => {
      const res = await request.get("/buildings");
      expect(res.status()).toBe(200);
      expect(res.headers()["x-frame-options"]).toBe("DENY");
      expect(res.headers()["cache-control"]).toBe("no-cache");
      expect(await res.text()).toContain('http-equiv="Content-Security-Policy"');
    },
  );

  test("the sign-in page has no way to create an account", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(/sign up/i)).toHaveCount(0);
  });

  test("rejects a wrong password", async ({ page }) => {
    await page.goto("/auth");
    await page.getByLabel("Email").fill("nobody@buildings-import.dev");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });
});

test.describe("signed in", () => {
  test.skip(
    !hasAccount,
    "Set TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD to run signed-in tests.",
  );
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("session survives a reload, and sign-out ends it", { tag: "@smoke" }, async ({ page }) => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Buildings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/);
    await page.goto("/buildings");
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("template downloads with the canonical columns", async ({ page }) => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Template" }).click();
    const file = await (await download).path();
    const sheet = read(readFileSync(file)).Sheets["Buildings"]!;
    expect(utils.sheet_to_json(sheet, { header: 1 })[0]).toEqual([
      "name",
      "address",
      "city",
      "country",
      "floors",
      "year_built",
    ]);
  });

  test("imports a messy file: maps columns, reports bad rows, skips duplicates", async ({
    page,
    tag,
  }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("messy.xlsx", [
        ["Quarterly property list"], // title row above the table
        [],
        ["Building Name", "Street", "Town", "Country", "Storeys", "Year of construction"],
        [`${tag} Acropolis Tower`, "1 Main St", "Athens", "Greece", 12, 1998],
        [`${tag} Harbour House`, "5 Port Rd", "Piraeus", "Greece", "7", 2005],
        ["", null, "Patras", null, 3, 1990],
        [`${tag} Bad Floors`, "x", "y", "z", "many", 2000],
        [`${tag} acropolis  TOWER`, " 1  main st", "ATHENS", "Greece", 12, 1998],
      ]),
    );

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Field for Building Name")).toHaveText("Name (required)");
    await expect(dialog.getByLabel("Field for Year of construction")).toHaveText("Year built");
    await expect(dialog.getByText("will be imported").locator("..")).toContainText("2");
    await dialog.getByText("Rows with errors (2)").click();
    await expect(dialog.getByText("Row 6 · Name is required.")).toBeVisible();
    await expect(
      dialog.getByText("Row 7 · Floors should be a whole number, like 12."),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Import 2 buildings" }).click();
    await expect(page.getByText(/Imported 2 buildings/)).toBeVisible();
    const rows = await showOnly(page, tag);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Harbour House" })).toContainText("Piraeus");
  });

  test("re-importing the same file adds nothing", async ({ page, tag }) => {
    const file = workbook("same.xlsx", [
      ["name", "city"],
      [`${tag} Old Mill`, "Patras"],
    ]);
    for (const expected of ["Import 1 building", null]) {
      await page.getByRole("button", { name: "Import Excel" }).click();
      await page.getByLabel("Excel file").setInputFiles(file);
      const dialog = page.getByRole("dialog");
      if (expected) {
        await dialog.getByRole("button", { name: expected }).click();
        await expect(page.getByText(/Imported 1 building/)).toBeVisible();
      } else {
        await expect(dialog.getByText("Duplicates (1)")).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Import 0 buildings" })).toBeDisabled();
        await dialog.getByRole("button", { name: "Cancel" }).click();
      }
    }
    await expect(await showOnly(page, tag)).toHaveCount(1);
  });

  test("a mapping without a name column cannot be imported until fixed", async ({ page, tag }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("no-name.xlsx", [
        ["Label", "City"],
        [`${tag} Depot`, "Larissa"],
      ]),
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("No column is mapped to Name, which is required.")).toBeVisible();

    await dialog.getByLabel("Field for Label").click();
    await page.getByRole("option", { name: "Name (required)" }).click();
    await expect(dialog.getByRole("button", { name: "Import 1 building" })).toBeEnabled();
    await expect(
      dialog.getByLabel("Field for Label").locator("../..").getByText("You"),
    ).toBeVisible();
  });

  test("a PNG renamed to .xlsx is refused with a readable message", async ({ page }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles({
      name: "photo.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    });
    await expect(
      page.getByRole("dialog").getByText(/could not be read as a spreadsheet|No column is mapped/),
    ).toBeVisible();
  });

  test("edits a row in place and validates like the import", async ({ page, tag }) => {
    const name = `${tag} Lighthouse`;
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("one.xlsx", [
        ["name", "floors"],
        [name, 3],
      ]),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Import 1 building" }).click();
    await expect(await showOnly(page, tag)).toHaveCount(1);

    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await page.getByLabel("Edit Floors").fill("three");
    await page.getByLabel("Edit Floors").press("Enter");
    await expect(page.getByText("Floors should be a whole number, like 12.")).toBeVisible();

    await page.getByLabel("Edit Floors").fill("4");
    await page.getByLabel("Edit City").fill("Chania");
    await page.getByRole("button", { name: "Save changes" }).click();
    const row = (await showOnly(page, tag)).first();
    await expect(row.getByRole("cell", { name: "Chania", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: "4", exact: true })).toBeVisible();
  });

  test(
    "import, search, delete with confirmation, and export",
    { tag: "@smoke" },
    async ({ page, tag }) => {
      await page.getByRole("button", { name: "Import Excel" }).click();
      await page.getByLabel("Excel file").setInputFiles(
        workbook("three.xlsx", [
          ["name", "city"],
          [`${tag} Alpha`, "Athens"],
          [`${tag} Beta`, "Berlin"],
          [`${tag} Gamma`, "Geneva"],
        ]),
      );
      await page.getByRole("dialog").getByRole("button", { name: "Import 3 buildings" }).click();
      await expect(await showOnly(page, tag)).toHaveCount(3);

      await page.getByLabel("Search buildings").fill(`${tag} Beta`);
      await expect(page.getByRole("row").filter({ hasText: tag })).toHaveCount(1);

      await page.getByRole("button", { name: `Delete ${tag} Beta` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      // While the dialog is open the table is aria-hidden, so wait for it to close first.
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(await showOnly(page, tag)).toHaveCount(2);

      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export" }).click();
      const sheet = read(readFileSync(await (await download).path())).Sheets["Buildings"]!;
      const names = utils
        .sheet_to_json<{ name: string }>(sheet)
        .map((r) => r.name)
        .filter((n) => n.startsWith(tag));
      expect(names.sort()).toEqual([`${tag} Alpha`, `${tag} Gamma`]);
    },
  );
});
