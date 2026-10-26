import { describe, expect, it } from "vitest";
import {
  applySuggestions,
  buildUserPrompt,
  parseSuggestions,
  responseSchema,
} from "./ai-mapping.ts";
import { resolveHeaders } from "./buildings.ts";

// Headers the rules place (name, city) plus three they cannot.
const headers = ["Building", "City", "Constructed", "Lvls", "Notes"];
const resolution = resolveHeaders(headers);

describe("resolution fixture", () => {
  it("leaves the unusual headers for the model", () => {
    expect(resolution.unresolved).toEqual(["Constructed", "Lvls", "Notes"]);
  });
});

describe("parseSuggestions", () => {
  it("accepts a well-formed answer", () => {
    const s = parseSuggestions(
      {
        mappings: [
          {
            header: "Constructed",
            field: "year_built",
            confidence: "high",
            reason: "Four-digit years.",
          },
          {
            header: "Lvls",
            field: "floors",
            confidence: "medium",
            reason: "Abbreviation of levels.",
          },
          { header: "Notes", field: "ignore", confidence: "high", reason: "Free text." },
        ],
      },
      resolution,
    );
    expect(s.map((x) => [x.header, x.field])).toEqual([
      ["Constructed", "year_built"],
      ["Lvls", "floors"],
      ["Notes", null],
    ]);
  });

  it("never lets the model remap a column the rules already placed", () => {
    const s = parseSuggestions(
      { mappings: [{ header: "Building", field: "address", confidence: "high", reason: "" }] },
      resolution,
    );
    expect(s).toEqual([]);
  });

  it("drops invented columns and fields", () => {
    const s = parseSuggestions(
      {
        mappings: [
          { header: "Height", field: "floors", confidence: "high", reason: "" },
          { header: "Lvls", field: "height_m", confidence: "high", reason: "" },
        ],
      },
      resolution,
    );
    expect(s).toEqual([]);
  });

  it("refuses fields that the rules already used", () => {
    const s = parseSuggestions(
      { mappings: [{ header: "Notes", field: "city", confidence: "high", reason: "" }] },
      resolution,
    );
    expect(s).toEqual([{ header: "Notes", field: null, confidence: "high", reason: "" }]);
  });

  it("resolves two claims on one field in favour of the more confident one", () => {
    const s = parseSuggestions(
      {
        mappings: [
          { header: "Lvls", field: "year_built", confidence: "low", reason: "" },
          { header: "Constructed", field: "year_built", confidence: "high", reason: "" },
        ],
      },
      resolution,
    );
    expect(s.find((x) => x.header === "Constructed")?.field).toBe("year_built");
    expect(s.find((x) => x.header === "Lvls")?.field).toBeNull();
  });

  it("returns nothing for malformed output instead of throwing", () => {
    expect(parseSuggestions(null, resolution)).toEqual([]);
    expect(parseSuggestions({ mappings: "year_built" }, resolution)).toEqual([]);
    expect(
      parseSuggestions(
        { mappings: [{ header: "Lvls", field: "floors", confidence: "certain" }] },
        resolution,
      ),
    ).toEqual([]);
  });
});

describe("applySuggestions", () => {
  it("applies high and medium confidence, and leaves low confidence for the user", () => {
    const suggestions = parseSuggestions(
      {
        mappings: [
          { header: "Constructed", field: "year_built", confidence: "high", reason: "" },
          { header: "Lvls", field: "floors", confidence: "low", reason: "" },
        ],
      },
      resolution,
    );
    const { mapping, applied } = applySuggestions(resolution, suggestions);
    expect(applied).toEqual(["Constructed"]);
    expect(mapping).toMatchObject({
      Building: "name",
      City: "city",
      Constructed: "year_built",
      Lvls: null,
    });
  });
});

describe("prompt and schema", () => {
  it("constrains headers to the unresolved columns", () => {
    const schema = responseSchema(resolution.unresolved);
    expect(schema.properties.mappings.items.properties.header.enum).toEqual([
      "Constructed",
      "Lvls",
      "Notes",
    ]);
    expect(schema.properties.mappings.items.properties.field.enum).toContain("ignore");
  });

  it("sends at most five sample rows with truncated cells", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      Building: `B${i}`,
      Notes: "x".repeat(500),
    }));
    const prompt = JSON.parse(buildUserPrompt(resolution, headers, rows));
    expect(prompt.sample_rows).toHaveLength(5);
    expect(prompt.sample_rows[0].Notes.length).toBeLessThanOrEqual(61);
    expect(prompt.fields_already_taken).toEqual([
      'name (column "Building")',
      'city (column "City")',
    ]);
  });
});
