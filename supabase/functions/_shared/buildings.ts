// Domain rules for buildings, shared by the import Edge Function (Deno) and the web app (Vite).
// Pure TypeScript with no imports, so both runtimes and the unit tests load the same file.

export const BUILDING_FIELDS = [
  "name",
  "address",
  "city",
  "country",
  "floors",
  "year_built",
] as const;
export type BuildingField = (typeof BUILDING_FIELDS)[number];

export const FIELD_LABELS: Record<BuildingField, string> = {
  name: "Name",
  address: "Address",
  city: "City",
  country: "Country",
  floors: "Floors",
  year_built: "Year built",
};

export const LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  text: { name: 200, address: 300, city: 100, country: 100 },
  floors: { min: 0, max: 300 },
  yearBuilt: { min: 1000, max: 2100 },
} as const;

export type BuildingInput = {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  floors: number | null;
  year_built: number | null;
};

/** Spreadsheet header (as written in the file) → field it maps to, or null to ignore it. */
export type ColumnMapping = Record<string, BuildingField | null>;

export type MappingSource = "exact" | "alias" | "ai" | "user";

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

/** Lowercase, strip accents and punctuation, collapse whitespace: "Έτος  Κατασκευής" → "ετος κατασκευης". */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Deterministic synonyms, checked before any model is involved. Keys are normalized headers.
const ALIASES: Record<string, BuildingField> = Object.fromEntries(
  (
    [
      [
        "name",
        [
          "building",
          "building name",
          "property",
          "property name",
          "title",
          "ονομα",
          "κτιριο",
          "ονομα κτιριου",
        ],
      ],
      ["address", ["street", "street address", "address line 1", "location", "διευθυνση", "οδος"]],
      ["city", ["town", "municipality", "πολη", "δημος"]],
      ["country", ["nation", "country name", "χωρα"]],
      [
        "floors",
        [
          "floor count",
          "number of floors",
          "no of floors",
          "storeys",
          "stories",
          "levels",
          "οροφοι",
          "αριθμος οροφων",
        ],
      ],
      [
        "year_built",
        [
          "year built",
          "year",
          "built",
          "construction year",
          "year of construction",
          "built in",
          "ετος κατασκευης",
          "ετος",
        ],
      ],
    ] as const
  ).flatMap(([field, aliases]) => aliases.map((alias) => [alias, field])),
);

export type HeaderResolution = {
  mapping: ColumnMapping;
  sources: Record<string, MappingSource>;
  /** Headers that neither an exact match nor an alias could place. */
  unresolved: string[];
};

/** Maps headers by exact field name, then by alias. Each field is used at most once, first header wins. */
export function resolveHeaders(headers: string[]): HeaderResolution {
  const mapping: ColumnMapping = {};
  const sources: Record<string, MappingSource> = {};
  const unresolved: string[] = [];
  const used = new Set<BuildingField>();

  for (const header of headers) {
    const key = normalizeHeader(header);
    const exact = BUILDING_FIELDS.find((f) => normalizeHeader(f) === key);
    const field = exact ?? ALIASES[key];

    if (field && !used.has(field)) {
      mapping[header] = field;
      sources[header] = exact ? "exact" : "alias";
      used.add(field);
    } else {
      mapping[header] = null;
      if (!field) unresolved.push(header);
    }
  }

  return { mapping, sources, unresolved };
}

/** Rejects mappings that are structurally invalid, whoever produced them (user, model, rules). */
export function checkMapping(headers: string[], mapping: ColumnMapping): string[] {
  const problems: string[] = [];
  const seen = new Map<BuildingField, string>();

  for (const [header, field] of Object.entries(mapping)) {
    if (!headers.includes(header)) problems.push(`Unknown column "${header}".`);
    if (field === null) continue;
    if (!BUILDING_FIELDS.includes(field)) {
      problems.push(`Column "${header}" maps to unknown field "${String(field)}".`);
      continue;
    }
    const previous = seen.get(field);
    if (previous)
      problems.push(`"${previous}" and "${header}" both map to ${FIELD_LABELS[field]}.`);
    seen.set(field, header);
  }

  if (!seen.has("name")) problems.push("No column is mapped to Name, which is required.");
  return problems;
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export type RowError = { row: number; field: BuildingField | null; message: string };

export type RowResult =
  { ok: true; row: number; value: BuildingInput } | { ok: false; row: number; errors: RowError[] };

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function parseWholeNumber(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const num =
    typeof value === "number" ? value : Number(String(value).trim().replace(/[\s,]/g, ""));
  if (!Number.isFinite(num) || !Number.isInteger(num)) return "invalid";
  return num;
}

/** Validates one spreadsheet row. `row` is the 1-based row number as the user sees it in Excel. */
export function validateRow(
  raw: Record<string, unknown>,
  mapping: ColumnMapping,
  row: number,
): RowResult {
  const pick = (field: BuildingField) => {
    const header = Object.keys(mapping).find((h) => mapping[h] === field);
    return header === undefined ? null : raw[header];
  };
  const errors: RowError[] = [];
  const fail = (field: BuildingField, message: string) => errors.push({ row, field, message });

  const text = {} as Record<"name" | "address" | "city" | "country", string | null>;
  for (const field of ["name", "address", "city", "country"] as const) {
    const value = cleanText(pick(field));
    if (value !== null && value.length > LIMITS.text[field]) {
      fail(field, `${FIELD_LABELS[field]} is longer than ${LIMITS.text[field]} characters.`);
    }
    text[field] = value;
  }
  if (text.name === null) fail("name", "Name is required.");

  const floors = parseWholeNumber(pick("floors"));
  if (floors === "invalid") fail("floors", "Floors must be a whole number.");
  else if (floors !== null && (floors < LIMITS.floors.min || floors > LIMITS.floors.max)) {
    fail("floors", `Floors must be between ${LIMITS.floors.min} and ${LIMITS.floors.max}.`);
  }

  const year = parseWholeNumber(pick("year_built"));
  if (year === "invalid") fail("year_built", "Year built must be a whole number.");
  else if (year !== null && (year < LIMITS.yearBuilt.min || year > LIMITS.yearBuilt.max)) {
    fail(
      "year_built",
      `Year built must be between ${LIMITS.yearBuilt.min} and ${LIMITS.yearBuilt.max}.`,
    );
  }

  if (errors.length > 0) return { ok: false, row, errors };
  return {
    ok: true,
    row,
    value: {
      name: text.name!,
      address: text.address,
      city: text.city,
      country: text.country,
      floors: floors as number | null,
      year_built: year as number | null,
    },
  };
}

/** True for rows where every cell is blank; these are skipped silently, as Excel users expect. */
export function isBlankRow(raw: Record<string, unknown>): boolean {
  return Object.values(raw).every((v) => cleanText(v) === null);
}

/**
 * Identity used to detect duplicates: same name, address and city, ignoring case and spacing.
 * Must stay in sync with the generated `dedupe_key` column in the database migration.
 */
export function dedupeKey(b: Pick<BuildingInput, "name" | "address" | "city">): string {
  const part = (v: string | null) => (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return [part(b.name), part(b.address), part(b.city)].join("|");
}

// ---------------------------------------------------------------------------
// Whole-sheet analysis
// ---------------------------------------------------------------------------

export type SheetAnalysis = {
  valid: { row: number; value: BuildingInput }[];
  errors: RowError[];
  /** Rows skipped because an earlier row in the file, or an existing building, has the same identity. */
  duplicates: { row: number; name: string; reason: "in_file" | "existing" }[];
  blankRows: number;
};

/**
 * Validates every data row. `firstDataRow` is the Excel row number of `rows[0]` (2 when the
 * header is on row 1). `existingKeys` are dedupe keys of buildings the user already has.
 */
export function analyzeRows(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  firstDataRow: number,
  existingKeys: ReadonlySet<string> = new Set(),
): SheetAnalysis {
  const result: SheetAnalysis = { valid: [], errors: [], duplicates: [], blankRows: 0 };
  const seen = new Set<string>();

  rows.forEach((raw, index) => {
    const row = firstDataRow + index;
    if (isBlankRow(raw)) {
      result.blankRows++;
      return;
    }
    const checked = validateRow(raw, mapping, row);
    if (!checked.ok) {
      result.errors.push(...checked.errors);
      return;
    }
    const key = dedupeKey(checked.value);
    if (existingKeys.has(key)) {
      result.duplicates.push({ row, name: checked.value.name, reason: "existing" });
    } else if (seen.has(key)) {
      result.duplicates.push({ row, name: checked.value.name, reason: "in_file" });
    } else {
      seen.add(key);
      result.valid.push({ row, value: checked.value });
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Header row detection
// ---------------------------------------------------------------------------

const HEADER_SCAN_ROWS = 20;

function filledCells(cells: unknown[] | undefined): number {
  return (cells ?? []).filter((c) => cleanText(c) !== null).length;
}

/**
 * Index of the header row in a sheet grid, or -1 if the sheet is empty. Real files often have a
 * title, a date or blank lines above the table, so the header is the first row that is at least
 * half as full as the widest row near the top, rather than simply the first non-empty row.
 */
export function findHeaderRow(grid: unknown[][]): number {
  const top = grid.slice(0, HEADER_SCAN_ROWS).map(filledCells);
  const widest = Math.max(0, ...top);
  if (widest === 0) return grid.findIndex((cells) => filledCells(cells) > 0);
  const needed = Math.max(Math.min(2, widest), Math.ceil(widest / 2));
  return top.findIndex((n) => n >= needed);
}
