// @ts-types="../_shared/vendor/xlsx-0.20.3/types.d.ts"
import * as XLSX from "../_shared/vendor/xlsx-0.20.3/xlsx.mjs";
import { findHeaderRow, LIMITS } from "../_shared/buildings.ts";

export type ParsedSheet = {
  sheetName: string;
  headers: string[];
  /** Excel row number of the header row (1-based). Data starts on the next row. */
  headerRow: number;
  rows: Record<string, unknown>[];
};

export class SheetError extends Error {}

/** Column index → Excel letters: 0 → "A", 27 → "AB". */
function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Reads the first sheet that has data. The header row is detected (findHeaderRow), so files with a
 * title row or blank lines above the table still work. Blank headers become "Column C" and
 * repeated headers get a suffix, so every column has a unique, user-recognisable key.
 */
export function parseWorkbook(bytes: Uint8Array): ParsedSheet {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      dense: true,
      cellFormula: false,
      cellHTML: false,
      // Hard cap on parsed rows: headroom for a few title rows above the table.
      sheetRows: LIMITS.maxRows + 20,
    });
  } catch {
    throw new SheetError("This file could not be read as a spreadsheet. Use .xlsx, .xls or .csv.");
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: true,
      raw: true,
    });
    const isEmpty = (cells: unknown[] | undefined) =>
      !cells || cells.every((c) => c === null || String(c).trim() === "");

    const headerIndex = findHeaderRow(grid);
    if (headerIndex === -1) continue;

    const width = Math.max(...grid.slice(headerIndex).map((r) => r.length));
    const seen = new Map<string, number>();
    const headers = Array.from({ length: width }, (_, i) => {
      const raw = grid[headerIndex]![i];
      const base =
        raw === null || raw === undefined || String(raw).trim() === ""
          ? `Column ${columnLetter(i)}`
          : String(raw).trim();
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return count === 1 ? base : `${base} (${count})`;
    });

    // Drop trailing blank rows so the row count matches what the user sees.
    let end = grid.length;
    while (end > headerIndex + 1 && isEmpty(grid[end - 1])) end--;
    const body = grid.slice(headerIndex + 1, end);

    if (body.length > LIMITS.maxRows) {
      throw new SheetError(
        `The sheet has more than ${LIMITS.maxRows} rows. Split it into smaller files.`,
      );
    }

    const rows = body.map((cells) =>
      Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? null])),
    );
    return { sheetName, headers, headerRow: headerIndex + 1, rows };
  }

  throw new SheetError("The file has no data.");
}
