import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { anthropicClient, anthropicModel, firstText } from "@/lib/ai/claude";

/**
 * Website fetch for enrichment, SSRF-guarded per spec patch 9. Defense in
 * depth, because this same function backs the future public URL-prefill
 * endpoint where the URL is attacker-supplied:
 *
 *  1. Cheap string screen on the hostname (obvious private names/literals).
 *  2. Connection-level guard: a custom DNS lookup on the undici agent
 *     rejects any resolved address that is loopback/private/link-local/
 *     unique-local/IPv4-mapped-private — the address CHECKED is the
 *     address CONNECTED to, closing DNS rebinding, and it applies to
 *     every redirect hop because all hops share the dispatcher.
 *  3. Redirects are walked manually (capped), re-screening each target.
 *  4. The body is streamed with a hard byte cap, never fully buffered.
 */

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast + reserved
  );
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family !== 6) return true;
  const lower = ip.toLowerCase();
  // IPv4-mapped / IPv4-compatible — judge the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") || lower.startsWith("fd") || // unique-local
    lower.startsWith("fe8") || lower.startsWith("fe9") ||
    lower.startsWith("fea") || lower.startsWith("feb") || // link-local
    lower.startsWith("ff") // multicast
  );
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.home\.arpa$/i,
];

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed, got ${url.protocol}`);
  }
  // Normalize: strip trailing dot (localhost. === localhost), unbracket IPv6.
  const host = url.hostname.replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) {
    throw new Error(`Refusing to fetch private/internal host: ${host}`);
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new Error(`Refusing to fetch private/internal address: ${host}`);
  }
  return url;
}

/** DNS lookup that refuses to hand undici any private address, so the
 * validated address is exactly the one connected to. */
const guardedLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (
    err: Error | null,
    address?: unknown,
    family?: number
  ) => void;
  const opts = typeof options === "object" && options !== null ? options : {};
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) {
      return cb(
        new Error(`Refusing to connect: ${hostname} resolves to private address ${bad.address}`)
      );
    }
    if (list.length === 0) return cb(new Error(`No addresses for ${hostname}`));
    const wantAll = (opts as { all?: boolean }).all === true;
    if (wantAll) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as typeof dnsLookup;

const ssrfSafeAgent = new Agent({ connect: { lookup: guardedLookup } });

const MAX_SITE_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

async function readCapped(res: UndiciResponse): Promise<string> {
  const lengthHeader = res.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_SITE_BYTES) {
    throw new Error(`Response too large: ${lengthHeader} bytes`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SITE_BYTES) {
      chunks.push(value.slice(0, value.byteLength - (total - MAX_SITE_BYTES)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchWebsiteText(rawUrl: string): Promise<string> {
  let url = assertPublicHttpUrl(rawUrl);

  for (let hop = 0; ; hop++) {
    const res = await undiciFetch(url, {
      dispatcher: ssrfSafeAgent,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "StartupBridge-enrichment/1.0" },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new Error(`Redirect without Location (HTTP ${res.status})`);
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }

    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
    const html = await readCapped(res);
    return htmlToText(html);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;|&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30_000);
}

export interface ExtractedProfile {
  tagline: string | null;
  description: string | null;
  sectors: string[] | null;
  tech_type: string[] | null;
  countries_active: string[] | null;
  hq_country: string | null;
  affiliation_hints: string[] | null;
  poc_evidence: string | null;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    tagline: { type: ["string", "null"], description: "One-line value proposition, max 90 chars" },
    description: { type: ["string", "null"], description: "2-3 sentence factual description of what the company builds and for whom" },
    sectors: { type: ["array", "null"], items: { type: "string" }, description: "Lowercase sector tags, e.g. health, agriculture, climate, water, urban, energy, logistics" },
    tech_type: { type: ["array", "null"], items: { type: "string" }, description: "Lowercase technology tags, e.g. machine_learning, iot, remote_sensing, mobile, sms, biotech, hardware" },
    countries_active: { type: ["array", "null"], items: { type: "string" }, description: "ISO 3166-1 alpha-2 codes of countries where deployments or operations are evidenced" },
    hq_country: { type: ["string", "null"], description: "ISO alpha-2 headquarters country, only if stated or strongly evidenced" },
    affiliation_hints: { type: ["array", "null"], items: { type: "string" }, description: "Names of universities, accelerators, research institutes, or government labs the site claims a relationship with" },
    poc_evidence: { type: ["string", "null"], description: "Concrete deployment or pilot evidence found on the site: partner type, location, scale, results. null if none found" },
  },
  required: ["tagline", "description", "sectors", "tech_type", "countries_active", "hq_country", "affiliation_hints", "poc_evidence"],
  additionalProperties: false,
} as const;

/**
 * Claude extracts a structured profile from website text. Everything it
 * returns is tagged ai_inferred by the caller — provenance rules decide
 * what may actually be written.
 */
export async function extractStartupProfile(
  siteText: string,
  startupName: string
): Promise<ExtractedProfile> {
  const message = await anthropicClient().messages.create({
    model: anthropicModel(),
    max_tokens: 1200,
    output_config: {
      format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
    },
    system:
      "You extract structured facts from startup websites for a matchmaking " +
      "database. Only state what the text supports; use null when the site " +
      "does not say. Hunt specifically for proof-of-concept evidence: pilots, " +
      "field deployments, named partner types, locations, scale, results.",
    messages: [
      {
        role: "user",
        content:
          `Website text for the startup "${startupName}":\n\n${siteText}\n\n` +
          `Extract the profile fields. Be conservative: null over guess.`,
      },
    ],
  });
  return JSON.parse(firstText(message)) as ExtractedProfile;
}
