import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/lib/env";

/** Model string lives in env per spec; claude-sonnet-4-6 is the default. */
export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

let client: Anthropic | null = null;

export function anthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  }
  return client;
}

/** Extract the first text block, guarding refusals and truncation. */
export function firstText(message: Anthropic.Message): string {
  if (message.stop_reason === "refusal") {
    throw new Error("Model refused the request");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Response truncated at max_tokens — raise the limit");
  }
  if (message.stop_reason === "model_context_window_exceeded") {
    throw new Error("Context window exceeded — input too large");
  }
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("No text block in model response");
  }
  return block.text;
}
