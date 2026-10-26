import { readFileSync } from "node:fs";
import { read, utils } from "xlsx";
import { clearBuildings, expect, hasAccount, signIn, test, workbook } from "./fixtures";

test.describe("signed out", () => {
  test("/ and /buildings bounce a signed-out visitor to /auth", async ({ page }) => {
    await page.goto("/buildings");
    await expect(page).toHaveURL(/\/auth$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("deep links are served by the SPA shell, with security headers", async ({ request }) => {
    const res = await request.get("/buildings");
    expect(res.status()).toBe(200);
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["cache-control"]).toBe("no-cache");
    expect(await res.text()).toContain('http-equiv="Content-Security-Policy"');
  });

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
    await clearBuildings();
    await signIn(page);
  });

  test("session survives a reload, and sign-out ends it", async ({ page }) => {
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
  }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("messy.xlsx", [
        ["Quarterly property list"], // title row above the table
        [],
        ["Building Name", "Street", "Town", "Country", "Storeys", "Year of construction"],
        ["Acropolis Tower", "1 Main St", "Athens", "Greece", 12, 1998],
        ["Harbour House", "5 Port Rd", "Piraeus", "Greece", "7", 2005],
        ["", null, "Patras", null, 3, 1990],
        ["Bad Floors", "x", "y", "z", "many", 2000],
        ["acropolis tower", " 1  main st", "ATHENS", "Greece", 12, 1998],
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
    await expect(page.getByRole("cell", { name: "Acropolis Tower", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Harbour House", exact: true })).toBeVisible();
    await expect(page.getByText("2 buildings", { exact: true })).toBeVisible();
  });

  test("re-importing the same file adds nothing", async ({ page }) => {
    const file = workbook("same.xlsx", [
      ["name", "city"],
      ["Old Mill", "Patras"],
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
    await expect(page.getByText("1 building", { exact: true })).toBeVisible();
  });

  test("a mapping without a name column cannot be imported until fixed", async ({ page }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("no-name.xlsx", [
        ["Label", "City"],
        ["Depot", "Larissa"],
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

  test("edits a row in place and validates like the import", async ({ page }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("one.xlsx", [
        ["name", "floors"],
        ["Lighthouse", 3],
      ]),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Import 1 building" }).click();
    await expect(page.getByRole("cell", { name: "Lighthouse", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Edit Lighthouse" }).click();
    await page.getByLabel("Edit Floors").fill("three");
    await page.getByLabel("Edit Floors").press("Enter");
    await expect(page.getByText("Floors should be a whole number, like 12.")).toBeVisible();

    await page.getByLabel("Edit Floors").fill("4");
    await page.getByLabel("Edit City").fill("Chania");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("cell", { name: "Chania", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "4", exact: true })).toBeVisible();
  });

  test("search, delete with confirmation, and export", async ({ page }) => {
    await page.getByRole("button", { name: "Import Excel" }).click();
    await page.getByLabel("Excel file").setInputFiles(
      workbook("three.xlsx", [
        ["name", "city"],
        ["Alpha", "Athens"],
        ["Beta", "Berlin"],
        ["Gamma", "Geneva"],
      ]),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Import 3 buildings" }).click();
    await expect(page.getByText("3 buildings", { exact: true })).toBeVisible();

    await page.getByLabel("Search buildings").fill("berl");
    await expect(page.getByRole("cell", { name: "Beta", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Alpha", exact: true })).toHaveCount(0);
    await page.getByLabel("Search buildings").fill("");

    await page.getByRole("button", { name: "Delete Beta" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("2 buildings", { exact: true })).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export" }).click();
    const sheet = read(readFileSync(await (await download).path())).Sheets["Buildings"]!;
    const names = utils.sheet_to_json<{ name: string }>(sheet).map((r) => r.name);
    expect(names.sort()).toEqual(["Alpha", "Gamma"]);
  });
});
