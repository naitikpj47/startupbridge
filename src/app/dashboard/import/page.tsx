"use client";

import { useState } from "react";
import { importCsvRows, type CsvImportRow } from "../actions";
import { PageTitle } from "../bits";

/**
 * CSV import: parse client-side, map columns to schema fields, dedupe on
 * domain server-side, land as source=csv_import / provenance=premium_db /
 * status=under_review, then enrichment jobs run.
 */

const TARGETS: { key: keyof CsvImportRow; label: string; required?: boolean }[] = [
  { key: "name", label: "Name", required: true },
  { key: "website", label: "Website", required: true },
  { key: "tagline", label: "Tagline" },
  { key: "description", label: "Description" },
  { key: "contact_name", label: "Contact name" },
  { key: "contact_email", label: "Contact email" },
  { key: "sectors", label: "Sectors (| separated)" },
  { key: "countries_active", label: "Countries active (ISO, comma/| sep)" },
  { key: "hq_country", label: "HQ country (ISO)" },
  { key: "team_size", label: "Team size" },
  { key: "funding_raised_usd", label: "Funding raised (USD)" },
  { key: "stage", label: "Stage" },
];

/** Small, correct-enough CSV parser: quotes, escaped quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export default function ImportPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{
    imported: number;
    skippedDuplicates: number;
    errors: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File) {
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      if (parsed.length < 2) {
        setError("That file needs a header row and at least one data row.");
        return;
      }
      setHeaders(parsed[0]);
      setRows(parsed.slice(1));
      // Auto-map columns whose header matches a target key or label.
      const auto: Record<number, string> = {};
      parsed[0].forEach((h, i) => {
        const norm = h.trim().toLowerCase().replace(/\s+/g, "_");
        const hit = TARGETS.find(
          (t) => t.key === norm || t.label.toLowerCase().startsWith(norm)
        );
        if (hit) auto[i] = hit.key;
      });
      setMapping(auto);
    };
    reader.readAsText(file);
  }

  async function runImport() {
    setError(null);
    const mapped = Object.values(mapping);
    if (!mapped.includes("name") || !mapped.includes("website")) {
      setError("Map at least the Name and Website columns.");
      return;
    }
    setBusy(true);
    try {
      const payload: CsvImportRow[] = rows.map((r) => {
        const obj: Record<string, string> = {};
        for (const [colIdx, target] of Object.entries(mapping)) {
          if (target) obj[target] = r[Number(colIdx)] ?? "";
        }
        return obj as CsvImportRow;
      });
      const res = await importCsvRows(payload);
      setResult(res);
      fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle
        title="CSV import"
        sub="Bulk-load startups from a database export. Deduped on domain; provenance recorded as premium_db; everything lands in the review queue."
      />

      <div className="mt-8 space-y-6">
        <label className="block w-fit cursor-pointer border border-line bg-surface px-4 py-2.5 text-sm text-ink-secondary transition-colors duration-150 hover:bg-well">
          Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>

        {headers.length > 0 && (
          <>
            <div className="border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink">
                Map columns <span className="font-normal text-ink-faint">({rows.length} rows)</span>
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-36 truncate text-ink" title={h}>{h || `(column ${i + 1})`}</span>
                    <span className="text-ink-faint">→</span>
                    <select
                      value={mapping[i] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}
                      className="flex-1 border border-line bg-surface px-2 py-1 text-xs"
                    >
                      <option value="">ignore</option>
                      {TARGETS.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}{t.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={runImport}
              disabled={busy}
              className="bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
            >
              {busy ? "Importing…" : `Import ${rows.length} rows`}
            </button>
          </>
        )}

        {error && <p className="text-sm text-err">{error}</p>}

        {result && (
          <div className="animate-rise border border-line bg-surface p-5 text-sm">
            <p className="text-ink">
              Imported <span className="font-mono tabular-nums">{result.imported}</span> ·
              skipped <span className="font-mono tabular-nums">{result.skippedDuplicates}</span> duplicates ·
              <span className="font-mono tabular-nums"> {result.errors.length}</span> errors
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-err">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-faint">
              Imports are scoring in the background and will appear in the
              review queue — use "sort by relevance" there for bulk review.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
