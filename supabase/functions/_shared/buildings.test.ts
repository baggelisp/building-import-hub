import { describe, expect, it } from "vitest";
import {
  analyzeRows,
  checkMapping,
  dedupeKey,
  findHeaderRow,
  normalizeHeader,
  resolveHeaders,
  validateRow,
  type ColumnMapping,
} from "./buildings.ts";

const canonical: ColumnMapping = {
  name: "name",
  address: "address",
  city: "city",
  country: "country",
  floors: "floors",
  year_built: "year_built",
};

describe("normalizeHeader", () => {
  it("lowercases and strips accents, punctuation and extra spaces", () => {
    expect(normalizeHeader("  Year_Built ")).toBe("year built");
    expect(normalizeHeader("Έτος  Κατασκευής")).toBe("ετος κατασκευης");
    expect(normalizeHeader("No. of floors")).toBe("no of floors");
  });
});

describe("resolveHeaders", () => {
  it("maps the template headers exactly", () => {
    const r = resolveHeaders(["name", "address", "city", "country", "floors", "year_built"]);
    expect(r.mapping).toEqual(canonical);
    expect(r.unresolved).toEqual([]);
    expect(Object.values(r.sources)).toEqual(Array(6).fill("exact"));
  });

  it("maps synonyms in English and Greek", () => {
    const r = resolveHeaders([
      "Building Name",
      "Street",
      "Πόλη",
      "Χώρα",
      "Storeys",
      "Year of construction",
    ]);
    expect(r.mapping).toEqual({
      "Building Name": "name",
      Street: "address",
      Πόλη: "city",
      Χώρα: "country",
      Storeys: "floors",
      "Year of construction": "year_built",
    });
    expect(r.sources["Street"]).toBe("alias");
  });

  it("reports headers it cannot place, for the AI step", () => {
    const r = resolveHeaders(["name", "Constructed", "Notes"]);
    expect(r.unresolved).toEqual(["Constructed", "Notes"]);
    expect(r.mapping["Constructed"]).toBeNull();
  });

  it("gives a field to the first matching column only", () => {
    const r = resolveHeaders(["name", "Building name"]);
    expect(r.mapping).toEqual({ name: "name", "Building name": null });
    // A second claimant is not "unresolved": the model must not be asked to re-place it.
    expect(r.unresolved).toEqual([]);
  });
});

describe("checkMapping", () => {
  const headers = ["A", "B"];

  it("requires a name column", () => {
    expect(checkMapping(headers, { A: "city", B: null })).toContain(
      "No column is mapped to Name, which is required.",
    );
  });

  it("rejects two columns on one field", () => {
    expect(checkMapping(headers, { A: "name", B: "name" })).toEqual([
      '"A" and "B" both map to Name.',
    ]);
  });

  it("rejects unknown columns and fields", () => {
    const problems = checkMapping(headers, { A: "name", C: "city", B: "height" as never });
    expect(problems).toContain('Unknown column "C".');
    expect(problems).toContain('Column "B" maps to unknown field "height".');
  });

  it("accepts a valid mapping", () => {
    expect(checkMapping(headers, { A: "name", B: null })).toEqual([]);
  });
});

describe("validateRow", () => {
  it("cleans text and parses numbers written as text", () => {
    const r = validateRow(
      {
        name: "  Acropolis   Tower ",
        address: "",
        city: "Athens",
        country: null,
        floors: "12",
        year_built: 1998,
      },
      canonical,
      2,
    );
    expect(r).toEqual({
      ok: true,
      row: 2,
      value: {
        name: "Acropolis Tower",
        address: null,
        city: "Athens",
        country: null,
        floors: 12,
        year_built: 1998,
      },
    });
  });

  it("accepts thousands separators but not decimals", () => {
    expect(validateRow({ name: "A", year_built: "1,998" }, canonical, 2).ok).toBe(true);
    const r = validateRow({ name: "A", floors: 2.5 }, canonical, 7);
    expect(r).toEqual({
      ok: false,
      row: 7,
      errors: [{ row: 7, field: "floors", message: "Floors should be a whole number, like 12." }],
    });
  });

  it("reports every problem in a row, not just the first", () => {
    const r = validateRow({ name: "", floors: -1, year_built: 3000 }, canonical, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toEqual(["name", "floors", "year_built"]);
  });

  it("enforces text length limits", () => {
    const r = validateRow({ name: "x".repeat(201) }, canonical, 2);
    expect(r.ok).toBe(false);
  });

  it("reads values through a custom mapping", () => {
    const r = validateRow(
      { Building: "HQ", Built: "1975" },
      { Building: "name", Built: "year_built" },
      3,
    );
    expect(r.ok && r.value).toMatchObject({ name: "HQ", year_built: 1975 });
  });
});

describe("dedupeKey", () => {
  it("ignores case and spacing, and keeps fields apart", () => {
    expect(dedupeKey({ name: "Acropolis  Tower", address: " 1 Main St", city: "ATHENS" })).toBe(
      dedupeKey({ name: "acropolis tower", address: "1 main st", city: "Athens" }),
    );
    expect(dedupeKey({ name: "A", address: null, city: "B" })).toBe("a||b");
    expect(dedupeKey({ name: "A", address: "B", city: null })).not.toBe(
      dedupeKey({ name: "A", address: null, city: "B" }),
    );
  });
});

describe("analyzeRows", () => {
  const rows = [
    { name: "Acropolis Tower", address: "1 Main St", city: "Athens" },
    { name: "", address: "", city: "" }, // blank row: skipped silently
    { name: "acropolis tower", address: "1 main st", city: "athens" }, // same building as row 2, different casing
    { name: "Harbour House", floors: "many" }, // invalid
    { name: "Old Mill", city: "Patras" }, // already exists
    { name: "New Wing" },
  ];

  it("classifies rows and numbers them as Excel does", () => {
    const existing = new Set([dedupeKey({ name: "Old Mill", address: null, city: "Patras" })]);
    const a = analyzeRows(rows, canonical, 2, existing);

    expect(a.valid.map((v) => [v.row, v.value.name])).toEqual([
      [2, "Acropolis Tower"],
      [7, "New Wing"],
    ]);
    expect(a.errors).toEqual([
      { row: 5, field: "floors", message: "Floors should be a whole number, like 12." },
    ]);
    expect(a.duplicates).toEqual([
      { row: 4, name: "acropolis tower", reason: "in_file" },
      { row: 6, name: "Old Mill", reason: "existing" },
    ]);
    expect(a.blankRows).toBe(1);
  });
});

describe("findHeaderRow", () => {
  it("skips a title row and blank lines above the table", () => {
    const grid = [["Quarterly property list"], [], ["name", "city", "floors"], ["A", "Athens", 3]];
    expect(findHeaderRow(grid)).toBe(2);
  });

  it("uses the first row when the table starts at the top", () => {
    expect(
      findHeaderRow([
        ["name", "city"],
        ["A", "B"],
      ]),
    ).toBe(0);
  });

  it("handles single-column sheets and empty sheets", () => {
    expect(findHeaderRow([[], ["name"], ["A"]])).toBe(1);
    expect(findHeaderRow([[], [null, ""]])).toBe(-1);
  });
});
