import { countryNames } from "@/lib/countries";

/**
 * ONE canonical profile_text template for every startup — thin and rich
 * profiles compete on the same footing. Missing fields simply omit their
 * line; the field order never varies. This exact text is what gets
 * embedded, so changing the template means re-embedding everyone.
 */
export interface StartupTextInput {
  name: string;
  tagline: string | null;
  description: string | null;
  sectors: string[] | null;
  tech_type: string[] | null;
  countries_active: string[] | null;
}

export function composeStartupProfileText(s: StartupTextInput): string {
  const lines: string[] = [s.name];
  if (s.tagline) lines.push(s.tagline);
  if (s.description) lines.push(s.description);
  if (s.sectors?.length) lines.push(`Sectors: ${s.sectors.join(", ")}`);
  if (s.tech_type?.length) lines.push(`Technology: ${s.tech_type.join(", ")}`);
  if (s.countries_active?.length)
    lines.push(`Active in: ${countryNames(s.countries_active).join(", ")}`);
  return lines.join("\n");
}

export interface ProblemTextInput {
  title: string;
  country: string | null;
  sector: string | null;
  description: string | null;
  enriched_brief: string | null;
}

/** Canonical problem text — the problem-side embedding input. */
export function composeProblemText(p: ProblemTextInput): string {
  const lines: string[] = [p.title];
  if (p.country) lines.push(`Country: ${countryNames([p.country]).join("")}`);
  if (p.sector) lines.push(`Sector: ${p.sector}`);
  if (p.description) lines.push(p.description);
  if (p.enriched_brief) lines.push(p.enriched_brief);
  return lines.join("\n");
}
