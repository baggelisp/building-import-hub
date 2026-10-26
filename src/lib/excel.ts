import { BUILDING_FIELDS } from "@shared/buildings";
import type { Building } from "./buildings-api";

// SheetJS is ~400 KB, so it is loaded on first use rather than with the page.
const loadXlsx = () => import("xlsx");

/** Template with the canonical headers and one example row; importing it as-is creates one building. */
export async function downloadTemplate() {
  const { utils, writeFile } = await loadXlsx();
  const sheet = utils.aoa_to_sheet([
    [...BUILDING_FIELDS],
    ["Example Tower", "1 Main St", "Athens", "Greece", 12, 1998],
  ]);
  sheet["!cols"] = [{ wch: 24 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 10 }];
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, "Buildings");
  writeFile(book, "buildings-template.xlsx");
}

/** Same header row as the template, so an export is itself a valid import file (round trip). */
export async function exportBuildings(buildings: Building[]) {
  const { utils, writeFile } = await loadXlsx();
  const rows = buildings.map((b) => Object.fromEntries(BUILDING_FIELDS.map((f) => [f, b[f]])));
  const sheet = utils.json_to_sheet(rows, { header: [...BUILDING_FIELDS] });
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, "Buildings");
  writeFile(book, `buildings-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
