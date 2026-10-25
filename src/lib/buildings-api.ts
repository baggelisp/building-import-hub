import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { AiSuggestion } from "@shared/ai-mapping";
import type { BuildingInput, ColumnMapping, MappingSource, RowError } from "@shared/buildings";

export type Building = Tables<"buildings">;

const PAGE_SIZE = 1000; // PostgREST's max rows per request

/** Every building of the signed-in user (RLS scopes the query), newest first, across pages. */
export async function fetchBuildings(): Promise<Building[]> {
  const all: Building[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("buildings")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id") // stable tiebreak so pages never overlap
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE_SIZE) return all;
  }
}

export async function deleteBuildings(ids: string[]): Promise<void> {
  const { error } = await supabase.from("buildings").delete().in("id", ids);
  if (error) throw error;
}

export type ImportPreview = {
  sheetName: string;
  headers: string[];
  headerRow: number;
  mapping: ColumnMapping;
  sources: Record<string, MappingSource>;
  mappingProblems: string[];
  ai:
    | { status: "ok"; model: string; suggestions: AiSuggestion[] }
    | { status: "failed"; message: string }
    | { status: "disabled" };
  summary: { rows: number; valid: number; invalidRows: number; duplicates: number };
  errors: RowError[];
  duplicates: { row: number; name: string; reason: "in_file" | "existing" }[];
  sample: { row: number; value: BuildingInput }[];
};

export type ImportResult = {
  inserted: number;
  rows: number;
  valid: number;
  invalidRows: number;
  duplicates: number;
};

async function callImport<T>(
  file: File,
  action: "preview" | "commit",
  mapping?: ColumnMapping,
): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  body.append("action", action);
  if (mapping) body.append("mapping", JSON.stringify(mapping));

  const { data, error } = await supabase.functions.invoke<T>("import-buildings", { body });
  if (error) {
    // invoke() hides the response body behind a generic message; surface the function's own error.
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload && typeof payload.error === "string") throw new Error(payload.error);
    }
    throw new Error("The import service could not be reached. Try again.");
  }
  return data as T;
}

export const previewImport = (file: File, mapping?: ColumnMapping) =>
  callImport<ImportPreview>(file, "preview", mapping);

export const commitImport = (file: File, mapping: ColumnMapping) =>
  callImport<ImportResult>(file, "commit", mapping);
