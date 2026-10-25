// Excel import, in two steps over the same endpoint:
//   action=preview  parse the file, map columns (rules first, then AI for the rest), validate
//                   every row and report what would happen. Writes nothing.
//   action=commit   re-parse the same file with the mapping the user confirmed and insert the
//                   valid, non-duplicate rows in one statement (all or nothing).
// The client never sends rows, only the file: the server is the single source of truth for
// what gets inserted. Inserts run with the caller's JWT, so row-level security still applies.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeRows,
  checkMapping,
  type ColumnMapping,
  LIMITS,
  type MappingSource,
  resolveHeaders,
} from "../_shared/buildings.ts";
import { applySuggestions } from "../_shared/ai-mapping.ts";
import { type AiOutcome, suggestMapping } from "./claude.ts";
import { parseWorkbook, SheetError } from "./sheet.ts";

const MAX_REPORTED = 500;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): HeadersInit {
  // Auth is a bearer token, never a cookie, so CORS is defence in depth rather than the gate.
  const allow =
    ALLOWED_ORIGINS.length === 0
      ? "*"
      : origin && ALLOWED_ORIGINS.includes(origin)
        ? origin
        : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function existingKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("buildings")
      .select("dedupe_key")
      .order("id")
      .range(from, from + page - 1);
    if (error) throw new Error(`Could not read existing buildings: ${error.message}`);
    for (const row of data as { dedupe_key: string }[]) keys.add(row.dedupe_key);
    if (data.length < page) return keys;
  }
}

function parseMapping(value: FormDataEntryValue | null): ColumnMapping | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ColumnMapping)
      : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

  // --- Authenticate: verify the JWT signature and expiry, take the user id from it. ---
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in to import buildings." }, 401, origin);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (authError || !userId || claims.claims.role !== "authenticated") {
    return json({ error: "Your session has expired. Sign in again." }, 401, origin);
  }

  // --- Read the request. ---
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected a multipart form with a file." }, 400, origin);
  }
  const file = form.get("file");
  const action = form.get("action");
  if (!(file instanceof File)) return json({ error: "No file was uploaded." }, 400, origin);
  if (action !== "preview" && action !== "commit")
    return json({ error: "Unknown action." }, 400, origin);
  if (file.size === 0) return json({ error: "The file is empty." }, 400, origin);
  if (file.size > LIMITS.maxFileBytes) {
    return json(
      { error: `The file is larger than ${LIMITS.maxFileBytes / 1024 / 1024} MB.` },
      413,
      origin,
    );
  }

  try {
    const sheet = parseWorkbook(new Uint8Array(await file.arrayBuffer()));
    const resolution = resolveHeaders(sheet.headers);

    // --- Mapping: the user's confirmed mapping on commit; rules + AI on preview. ---
    let mapping: ColumnMapping;
    let sources: Record<string, MappingSource> = { ...resolution.sources };
    let ai: AiOutcome = { status: "ok", suggestions: [], model: "" };

    const requested = parseMapping(form.get("mapping"));
    if (action === "commit") {
      if (!requested)
        return json({ error: "Confirm the column mapping before importing." }, 400, origin);
      mapping = requested;
    } else if (requested) {
      // The user edited the mapping in the preview; re-validate with their choice.
      mapping = requested;
      for (const header of sheet.headers) {
        if (requested[header] !== resolution.mapping[header]) sources[header] = "user";
      }
    } else {
      ai = await suggestMapping(resolution, sheet.headers, sheet.rows);
      if (ai.status === "ok") {
        const applied = applySuggestions(resolution, ai.suggestions);
        mapping = applied.mapping;
        for (const header of applied.applied) sources[header] = "ai";
      } else {
        mapping = resolution.mapping;
      }
    }

    const problems = checkMapping(sheet.headers, mapping);
    if (problems.length > 0 && action === "commit")
      return json({ error: problems.join(" ") }, 400, origin);

    const analysis =
      problems.length > 0
        ? { valid: [], errors: [], duplicates: [], blankRows: 0 }
        : analyzeRows(sheet.rows, mapping, sheet.headerRow + 1, await existingKeys(supabase));

    const summary = {
      rows: sheet.rows.length - analysis.blankRows,
      valid: analysis.valid.length,
      invalidRows: new Set(analysis.errors.map((e) => e.row)).size,
      duplicates: analysis.duplicates.length,
    };

    if (action === "preview") {
      sources = Object.fromEntries(Object.entries(sources).filter(([h]) => mapping[h] !== null));
      return json(
        {
          sheetName: sheet.sheetName,
          headers: sheet.headers,
          headerRow: sheet.headerRow,
          mapping,
          sources,
          mappingProblems: problems,
          ai:
            ai.status === "ok"
              ? { status: "ok", model: ai.model, suggestions: ai.suggestions }
              : ai.status === "failed"
                ? { status: "failed", message: ai.message }
                : { status: "disabled" },
          summary,
          errors: analysis.errors.slice(0, MAX_REPORTED),
          duplicates: analysis.duplicates.slice(0, MAX_REPORTED),
          sample: analysis.valid.slice(0, 20),
        },
        200,
        origin,
      );
    }

    // --- Commit: one INSERT ... ON CONFLICT DO NOTHING, which PostgREST runs as one transaction. ---
    if (analysis.valid.length === 0) {
      return json({ inserted: 0, ...summary }, 200, origin);
    }
    const { data: inserted, error } = await supabase
      .from("buildings")
      .upsert(
        analysis.valid.map(({ value }) => ({ ...value, user_id: userId })),
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.error("insert failed", error.code, error.message);
      return json({ error: "The import could not be saved. Nothing was imported." }, 500, origin);
    }
    // Rows skipped by ON CONFLICT were inserted concurrently since the preview: count them as duplicates.
    const raced = analysis.valid.length - inserted.length;
    return json(
      { inserted: inserted.length, ...summary, duplicates: summary.duplicates + raced },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof SheetError) return json({ error: error.message }, 400, origin);
    console.error("import failed", error);
    return json(
      { error: "Something went wrong while importing. Nothing was imported." },
      500,
      origin,
    );
  }
});
