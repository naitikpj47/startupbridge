import { requireEnv } from "@/lib/env";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

/** One idempotent embeddings request, time-capped, with two retries on
 * 429/5xx or network failure. */
async function fetchWithRetry(key: string, batch: string[]): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 4 ** (attempt - 1)));
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`OpenAI embeddings HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Embed texts with OpenAI text-embedding-3-small. Batches of up to 100
 * inputs per request; asserts 1536 dimensions on every vector so a model
 * or config drift fails loudly instead of writing junk vectors.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = requireEnv("OPENAI_API_KEY");
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetchWithRetry(key, batch);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      if (item.embedding.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Expected ${EMBEDDING_DIMS} dims, got ${item.embedding.length}`
        );
      }
      out.push(item.embedding);
    }
  }

  if (out.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: sent ${texts.length}, got ${out.length}`
    );
  }
  return out;
}
