import Anthropic from "@anthropic-ai/sdk";
import type { HeaderResolution } from "../_shared/buildings.ts";
import {
  type AiSuggestion,
  buildUserPrompt,
  parseSuggestions,
  responseSchema,
  SYSTEM_PROMPT,
} from "../_shared/ai-mapping.ts";

const MODEL = "claude-opus-5-5";

export type AiOutcome =
  | { status: "ok"; suggestions: AiSuggestion[]; model: string }
  | { status: "disabled" }
  | { status: "failed"; message: string };

let client: Anthropic | undefined;

/**
 * Asks Claude to place the columns the rules could not. Never throws: the import works without
 * AI, so any failure (no key, timeout, refusal, malformed output) degrades to "unmapped".
 */
export async function suggestMapping(
  resolution: HeaderResolution,
  headers: string[],
  rows: Record<string, unknown>[],
): Promise<AiOutcome> {
  if (resolution.unresolved.length === 0) return { status: "ok", suggestions: [], model: MODEL };

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { status: "disabled" };
  client ??= new Anthropic({ apiKey, timeout: 15_000, maxRetries: 1 });

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Classification over a few dozen tokens of input: low effort keeps latency interactive.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: responseSchema(resolution.unresolved) },
      },
      // On a policy decline the API retries on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(resolution, headers, rows) }],
    });

    if (response.stop_reason === "refusal")
      return { status: "failed", message: "The model declined the request." };
    if (response.stop_reason === "max_tokens")
      return { status: "failed", message: "The model response was cut off." };

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text")
      return { status: "failed", message: "The model returned no answer." };

    return {
      status: "ok",
      suggestions: parseSuggestions(JSON.parse(text.text), resolution),
      model: response.model,
    };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return { status: "failed", message: "AI is rate limited." };
    if (error instanceof Anthropic.APIConnectionTimeoutError)
      return { status: "failed", message: "AI timed out." };
    if (error instanceof Anthropic.APIError) {
      console.error("anthropic api error", error.status, error.message);
      return { status: "failed", message: `AI request failed (${error.status ?? "network"}).` };
    }
    if (error instanceof SyntaxError)
      return { status: "failed", message: "The model returned invalid JSON." };
    throw error;
  }
}
