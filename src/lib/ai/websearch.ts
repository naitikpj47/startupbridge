import { requireEnv } from "@/lib/env";

/**
 * Direct web search, provider-agnostic.
 *
 * Why this exists: Anthropic's built-in web_search tool lets the model
 * decide queries and search sequentially, reasoning between each one.
 * Excellent judgement, but a multi-search research turn runs for many
 * minutes — too slow for an officer watching a screen.
 *
 * With a search API key we invert the loop: WE pick the queries, fire
 * them all in parallel, and hand the combined results to one model call.
 * Same source material, seconds instead of minutes.
 *
 * Set exactly one of these (checked in order):
 *   BING_SEARCH_API_KEY    — Bing Web Search. Add BING_CUSTOM_CONFIG_ID
 *                            too if the key is for a Custom Search
 *                            instance; the endpoint differs.
 *   BRAVE_SEARCH_API_KEY   — Brave Search API (generous free tier)
 *   SERPER_API_KEY         — serper.dev (Google results)
 *   TAVILY_API_KEY         — Tavily (built for agents)
 *
 * With none set, callers fall back to the built-in tool.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProvider = "bing" | "brave" | "serper" | "tavily" | null;

export function activeSearchProvider(): SearchProvider {
  if (process.env.BING_SEARCH_API_KEY) return "bing";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.SERPER_API_KEY) return "serper";
  if (process.env.TAVILY_API_KEY) return "tavily";
  return null;
}

async function bingSearch(query: string): Promise<SearchHit[]> {
  const customConfigId = process.env.BING_CUSTOM_CONFIG_ID;
  const base = customConfigId
    ? `https://api.bing.microsoft.com/v7.0/custom/search?customConfig=${encodeURIComponent(customConfigId)}&`
    : "https://api.bing.microsoft.com/v7.0/search?";
  const res = await fetch(
    `${base}q=${encodeURIComponent(query)}&count=${PER_QUERY}&responseFilter=Webpages`,
    {
      headers: {
        "Ocp-Apim-Subscription-Key": requireEnv("BING_SEARCH_API_KEY"),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  if (!res.ok) {
    throw new Error(`Bing search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    webPages?: { value?: { name: string; url: string; snippet?: string }[] };
  };
  return (json.webPages?.value ?? []).map((r) => ({
    title: r.name,
    url: r.url,
    snippet: r.snippet ?? "",
  }));
}

const PER_QUERY = 8;
const TIMEOUT_MS = 12_000;

async function braveSearch(query: string): Promise<SearchHit[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${PER_QUERY}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": requireEnv("BRAVE_SEARCH_API_KEY"),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  if (!res.ok) throw new Error(`Brave search ${res.status}`);
  const json = (await res.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (json.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
  }));
}

async function serperSearch(query: string): Promise<SearchHit[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": requireEnv("SERPER_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: PER_QUERY }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Serper search ${res.status}`);
  const json = (await res.json()) as {
    organic?: { title: string; link: string; snippet?: string }[];
  };
  return (json.organic ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? "",
  }));
}

async function tavilySearch(query: string): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("TAVILY_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, max_results: PER_QUERY }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily search ${res.status}`);
  const json = (await res.json()) as {
    results?: { title: string; url: string; content?: string }[];
  };
  return (json.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content ?? "",
  }));
}

/**
 * Run every query in parallel and return de-duplicated hits. A single
 * failing query never sinks the batch — partial results still beat none.
 */
export async function searchWeb(queries: string[]): Promise<SearchHit[]> {
  const provider = activeSearchProvider();
  if (!provider) throw new Error("No search provider configured");

  const run =
    provider === "bing" ? bingSearch
    : provider === "brave" ? braveSearch
    : provider === "serper" ? serperSearch
    : tavilySearch;

  const settled = await Promise.allSettled(queries.map((q) => run(q)));

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") {
      console.warn(`[search] a query failed: ${result.reason}`);
      continue;
    }
    for (const hit of result.value) {
      const key = hit.url.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  return hits;
}
