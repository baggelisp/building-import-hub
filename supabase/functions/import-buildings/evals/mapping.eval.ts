// Offline eval for the AI column-mapping fallback. Calls the model through the exact code path
// the Edge Function uses (rules first, then suggestMapping, then applySuggestions), so prompt,
// schema and validation changes are measured together.
//
//   cd supabase/functions
//   ANTHROPIC_API_KEY=... deno run --allow-env --allow-net --allow-read \
//     import-buildings/evals/mapping.eval.ts [--runs 3]
//
// Costs real money: 10 cases × runs requests to claude-opus-5-5 at low effort, each a few hundred
// tokens. Scoring separates the two kinds of error, because they are not equally bad:
//   wrong   — a field was APPLIED to a column that should have had another (or none). The user
//             may import bad data without noticing. This is the number to keep at zero.
//   missed  — the column was left unmapped (or only suggested at low confidence) although a field
//             was expected. The user sees "Don't import" and fixes it in one click.

import { applySuggestions } from "../../_shared/ai-mapping.ts";
import { type BuildingField, resolveHeaders } from "../../_shared/buildings.ts";
import { suggestMapping } from "../claude.ts";

type Case = {
  id: string;
  headers: string[];
  rows: Record<string, unknown>[];
  expect: Record<string, BuildingField | null>;
};

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("./cases.json", import.meta.url)));
const runsArg = Deno.args.indexOf("--runs");
const runs = runsArg >= 0 ? Number(Deno.args[runsArg + 1]) : 1;

if (!Deno.env.get("ANTHROPIC_API_KEY")) {
  console.error("Set ANTHROPIC_API_KEY to run the eval.");
  Deno.exit(2);
}

let correct = 0;
let wrong = 0;
let missed = 0;
let failedCalls = 0;
const lines: string[] = [];

for (const c of cases) {
  for (let run = 0; run < runs; run++) {
    const resolution = resolveHeaders(c.headers);
    const outcome = await suggestMapping(resolution, c.headers, c.rows);
    if (outcome.status !== "ok") {
      failedCalls++;
      lines.push(
        `✗ ${c.id}#${run}: call ${outcome.status}${"message" in outcome ? ` (${outcome.message})` : ""}`,
      );
      continue;
    }
    const { mapping } = applySuggestions(resolution, outcome.suggestions);
    for (const [header, expected] of Object.entries(c.expect)) {
      const got = mapping[header] ?? null;
      if (got === expected) correct++;
      else if (got === null) missed++;
      else wrong++;
      if (got !== expected) {
        const s = outcome.suggestions.find((x) => x.header === header);
        lines.push(
          `${got === null ? "·" : "✗"} ${c.id}#${run} "${header}": expected ${expected}, got ${got}` +
            (s ? ` [model: ${s.field} / ${s.confidence} — ${s.reason}]` : ""),
        );
      }
    }
  }
}

const total = correct + wrong + missed;
console.log(lines.join("\n") || "no mismatches");
console.log(
  `\n${cases.length} cases × ${runs} run(s): ${correct}/${total} correct, ${wrong} wrong (applied), ` +
    `${missed} missed (left for the user), ${failedCalls} failed calls`,
);
Deno.exit(wrong > 0 || failedCalls > 0 ? 1 : 0);
