"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Smart intake: URL first → server enriches in a background job (the UI
 * polls, shimmering) → founder confirms and edits → submit. If the
 * domain already exists as a scraped profile, the claim flow takes over.
 *
 * The founder questions follow the spec's NULL-vs-ZERO doctrine: every
 * "unknown" is distinct from a confirmed zero/no.
 */

const SECTORS = ["health", "agriculture", "climate", "water", "urban", "energy", "logistics"];
const SDGS = ["SDG2", "SDG3", "SDG6", "SDG7", "SDG11", "SDG13"];
const ORG_TYPES = ["university", "research_institute", "accelerator", "gov_lab"] as const;
const RELATIONSHIPS = ["spinoff", "incubated", "cohort", "research_partner"] as const;

const inputCls =
  "w-full border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none transition-colors duration-150";
const labelCls = "block text-xs font-medium uppercase tracking-wider text-ink-secondary";

interface Affiliation {
  org_name: string;
  org_type: string;
  relationship: string;
}

interface FormState {
  name: string;
  website: string;
  tagline: string;
  description: string;
  contact_name: string;
  contact_email: string;
  sectors: string[];
  tech_type: string;
  sdg_tags: string[];
  countries_active: string;
  hq_country: string;
  stage: string;
  team_size: string;
  funding_mode: "unknown" | "zero" | "amount";
  funding_amount: string;
  gov_mode: "unknown" | "no" | "yes";
  gov_note: string;
  poc_mode: "unknown" | "none" | "pilot_completed" | "deployed_in_field";
  poc_link: string;
  poc_partner: string;
  poc_location: string;
  poc_results: string;
  infra_mode: "unknown" | "plug_and_play" | "moderate" | "heavy";
  aff_mode: "unknown" | "none" | "some";
  affiliations: Affiliation[];
  pitch_deck_url: string;
  company_fax: string; // honeypot — humans never see it
}

const emptyForm: FormState = {
  name: "", website: "", tagline: "", description: "", contact_name: "",
  contact_email: "", sectors: [], tech_type: "", sdg_tags: [],
  countries_active: "", hq_country: "", stage: "", team_size: "",
  funding_mode: "unknown", funding_amount: "", gov_mode: "unknown",
  gov_note: "", poc_mode: "unknown", poc_link: "", poc_partner: "",
  poc_location: "", poc_results: "", infra_mode: "unknown",
  aff_mode: "unknown", affiliations: [], pitch_deck_url: "", company_fax: "",
};

type Step = "url" | "enriching" | "form" | "done" | "claim" | "duplicate";

export default function SubmitPage() {
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function startPrefill() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start enrichment.");
      setStep("enriching");
      fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
      pollJob(json.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function pollJob(jobId: string) {
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 120_000) {
        stopPoll();
        setError("Enrichment is taking too long — you can fill the form manually.");
        beginManualForm();
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.status === "succeeded" && json.result) {
          stopPoll();
          applyPrefill(json.result);
        } else if (json.status === "failed") {
          stopPoll();
          setError(`We couldn't read that site (${json.error ?? "unknown error"}). Fill the form manually.`);
          beginManualForm();
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
  }

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function beginManualForm() {
    setForm((f) => ({ ...f, website: url }));
    setStep("form");
  }

  function applyPrefill(result: {
    domain: string;
    existing: string | null;
    extracted: Record<string, unknown> | null;
  }) {
    if (result.existing === "claimable") {
      setStep("claim");
      return;
    }
    if (result.existing === "duplicate") {
      setStep("duplicate");
      return;
    }
    const x = (result.extracted ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    setForm((f) => ({
      ...f,
      website: url,
      name: f.name || result.domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()),
      tagline: str(x.tagline),
      description: str(x.description),
      sectors: arr(x.sectors).filter((s) => SECTORS.includes(s)),
      tech_type: arr(x.tech_type).join(", "),
      countries_active: arr(x.countries_active).join(", "),
      hq_country: str(x.hq_country),
      poc_results: str(x.poc_evidence),
    }));
    setStep("form");
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        website: form.website,
        tagline: form.tagline || null,
        description: form.description || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        sectors: form.sectors,
        tech_type: form.tech_type.split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean),
        sdg_tags: form.sdg_tags,
        countries_active: form.countries_active.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
        hq_country: /^[A-Za-z]{2}$/.test(form.hq_country.trim()) ? form.hq_country.trim().toUpperCase() : null,
        stage: form.stage || null,
        team_size: form.team_size ? Number(form.team_size) : null,
        funding_raised_usd:
          form.funding_mode === "zero" ? 0 :
          form.funding_mode === "amount" && form.funding_amount ? Number(form.funding_amount) : null,
        gov_experience: form.gov_mode === "yes" ? true : form.gov_mode === "no" ? false : null,
        gov_experience_note: form.gov_note || null,
        poc_status: form.poc_mode === "unknown" ? null : form.poc_mode,
        poc_evidence: composePocEvidence(),
        infra_intensity: form.infra_mode === "unknown" ? null : form.infra_mode,
        affiliations_confirmed_none: form.aff_mode === "none",
        affiliations: form.aff_mode === "some" ? form.affiliations.filter((a) => a.org_name.trim()) : [],
        pitch_deck_url: form.pitch_deck_url || null,
        company_fax: form.company_fax,
      };
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submission failed.");
      if (json.status === "claimable") setStep("claim");
      else if (json.status === "duplicate") setStep("duplicate");
      else setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }

  function composePocEvidence(): string | null {
    const parts: string[] = [];
    if (form.poc_link.trim()) parts.push(`Link: ${form.poc_link.trim()}`);
    if (form.poc_partner.trim()) parts.push(`Partner: ${form.poc_partner.trim()}`);
    if (form.poc_location.trim()) parts.push(`Location: ${form.poc_location.trim()}`);
    if (form.poc_results.trim()) parts.push(`Results: ${form.poc_results.trim()}`);
    return parts.length ? parts.join("\n") : null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            StartupBridge
          </Link>
          <span className="text-xs uppercase tracking-wider text-ink-faint">
            Submit your startup
          </span>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-2xl px-6 py-16">
          {step === "url" && (
            <div className="animate-rise">
              <h1 className="font-display text-3xl tracking-tight text-ink">
                Start with your website.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                We read your site and draft the profile for you — you confirm
                and correct it before anything is submitted. Nothing goes to
                the review team until you say so.
              </p>
              <div className="mt-8 flex gap-3">
                <input
                  className={inputCls}
                  placeholder="https://yourcompany.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && url && startPrefill()}
                  aria-label="Company website URL"
                />
                <button
                  onClick={startPrefill}
                  disabled={busy || !url.trim()}
                  className="shrink-0 bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
              {error && <p className="mt-3 text-sm text-err">{error}</p>}
              <button
                onClick={beginManualForm}
                className="mt-6 text-sm text-ink-secondary underline underline-offset-2 hover:text-ink"
              >
                Skip — I'll fill the form myself
              </button>
            </div>
          )}

          {step === "enriching" && (
            <div className="animate-rise">
              <h1 className="font-display text-3xl tracking-tight text-ink">
                Reading your site…
              </h1>
              <p className="mt-3 text-sm text-ink-secondary">
                Drafting your profile. This usually takes under a minute.
              </p>
              <div className="mt-10 space-y-3">
                <div className="shimmer h-8 w-2/3" />
                <div className="shimmer h-4 w-full" />
                <div className="shimmer h-4 w-5/6" />
                <div className="shimmer h-4 w-3/4" />
                <div className="mt-6 flex gap-2">
                  <div className="shimmer h-6 w-20" />
                  <div className="shimmer h-6 w-24" />
                  <div className="shimmer h-6 w-16" />
                </div>
              </div>
              {error && <p className="mt-4 text-sm text-err">{error}</p>}
            </div>
          )}

          {step === "form" && (
            <FormView
              form={form}
              set={set}
              setForm={setForm}
              error={error}
              busy={busy}
              onSubmit={submit}
            />
          )}

          {step === "done" && (
            <div className="animate-rise border border-line bg-surface p-8">
              <h1 className="font-display text-3xl tracking-tight text-ink">
                Submitted.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                Your profile is now with the review team. If it's approved,
                it enters the matching pool and you'll hear from a program
                officer when a problem statement fits. There's nothing else
                you need to do.
              </p>
              <Link href="/" className="mt-6 inline-block text-sm text-forest underline underline-offset-2">
                Back to the start
              </Link>
            </div>
          )}

          {step === "duplicate" && (
            <div className="animate-rise border border-line bg-surface p-8">
              <h1 className="font-display text-3xl tracking-tight text-ink">
                Already in the pool.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                A profile for this domain already exists and is being looked
                after. If you believe that's wrong, contact the team.
              </p>
            </div>
          )}

          {step === "claim" && <ClaimView website={url || form.website} />}
        </div>
      </main>
    </div>
  );
}

// ── Form ────────────────────────────────────────────────────────────────

function FormView({
  form, set, setForm, error, busy, onSubmit,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-3xl tracking-tight text-ink">
        Confirm your profile.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
        Anything we drafted from your site is editable. "Unknown" is always
        an honest answer — it's treated differently from a confirmed no.
      </p>

      <div className="mt-10 space-y-10">
        <Section title="Company">
          <Field label="Name *">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Website *">
            <input className={inputCls} value={form.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="Tagline">
            <input className={inputCls} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea className={`${inputCls} min-h-24`} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact name">
              <input className={inputCls} value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </Field>
            <Field label="Contact email">
              <input className={inputCls} type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
            </Field>
          </div>
          {/* Honeypot: hidden from humans, tempting to bots. */}
          <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
            <label>
              Company fax
              <input tabIndex={-1} autoComplete="off" value={form.company_fax} onChange={(e) => set("company_fax", e.target.value)} />
            </label>
          </div>
        </Section>

        <Section title="What you do">
          <Field label="Sectors">
            <Chips options={SECTORS} selected={form.sectors} onToggle={(s) =>
              set("sectors", form.sectors.includes(s) ? form.sectors.filter((x) => x !== s) : [...form.sectors, s])
            } />
          </Field>
          <Field label="SDGs">
            <Chips options={SDGS} selected={form.sdg_tags} onToggle={(s) =>
              set("sdg_tags", form.sdg_tags.includes(s) ? form.sdg_tags.filter((x) => x !== s) : [...form.sdg_tags, s])
            } />
          </Field>
          <Field label="Technology (comma-separated)" hint="e.g. machine_learning, iot, mobile">
            <input className={inputCls} value={form.tech_type} onChange={(e) => set("tech_type", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Countries active (ISO codes)" hint="e.g. PH, ID, VN">
              <input className={inputCls} value={form.countries_active} onChange={(e) => set("countries_active", e.target.value)} />
            </Field>
            <Field label="HQ country (ISO code)" hint="e.g. SG">
              <input className={inputCls} maxLength={2} value={form.hq_country} onChange={(e) => set("hq_country", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stage (descriptive only — never scored)">
              <select className={inputCls} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
                <option value="">—</option>
                {["pre_seed", "seed", "series_a", "growth", "bootstrapped", "spinout"].map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
            </Field>
            <Field label="Team size">
              <input className={inputCls} type="number" min={1} value={form.team_size} onChange={(e) => set("team_size", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Funding">
          <TriRadio
            name="funding"
            value={form.funding_mode}
            onChange={(v) => set("funding_mode", v as FormState["funding_mode"])}
            options={[
              { value: "unknown", label: "Prefer not to say / unknown" },
              { value: "zero", label: "No outside funding raised (confirmed)" },
              { value: "amount", label: "We've raised outside funding" },
            ]}
          />
          {form.funding_mode === "amount" && (
            <Field label="Total raised (USD)">
              <input className={`${inputCls} tabular-nums`} type="number" min={0} value={form.funding_amount} onChange={(e) => set("funding_amount", e.target.value)} />
            </Field>
          )}
        </Section>

        <Section title="Government experience">
          <TriRadio
            name="gov"
            value={form.gov_mode}
            onChange={(v) => set("gov_mode", v as FormState["gov_mode"])}
            options={[
              { value: "unknown", label: "Unsure" },
              { value: "no", label: "No government work yet (confirmed)" },
              { value: "yes", label: "Yes — we've worked with government" },
            ]}
          />
          {form.gov_mode === "yes" && (
            <Field label="Briefly, what was it?">
              <input className={inputCls} value={form.gov_note} onChange={(e) => set("gov_note", e.target.value)} />
            </Field>
          )}
        </Section>

        <Section title="Proof of concept" subtitle="Evidence matters more than claims — introductions only happen once deployability is verified.">
          <TriRadio
            name="poc"
            value={form.poc_mode}
            onChange={(v) => set("poc_mode", v as FormState["poc_mode"])}
            options={[
              { value: "unknown", label: "Prefer not to say" },
              { value: "none", label: "No pilots yet" },
              { value: "pilot_completed", label: "Pilot completed" },
              { value: "deployed_in_field", label: "Deployed in the field" },
            ]}
          />
          {(form.poc_mode === "pilot_completed" || form.poc_mode === "deployed_in_field") && (
            <div className="space-y-4">
              <Field label="Evidence link" hint="A report, press mention, or case study URL">
                <input className={inputCls} value={form.poc_link} onChange={(e) => set("poc_link", e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Partner type" hint="e.g. provincial health office">
                  <input className={inputCls} value={form.poc_partner} onChange={(e) => set("poc_partner", e.target.value)} />
                </Field>
                <Field label="Location">
                  <input className={inputCls} value={form.poc_location} onChange={(e) => set("poc_location", e.target.value)} />
                </Field>
              </div>
              <Field label="Results" hint="Scale, duration, measured outcomes">
                <textarea className={`${inputCls} min-h-20`} value={form.poc_results} onChange={(e) => set("poc_results", e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Infrastructure required to deploy your solution">
            <TriRadio
              name="infra"
              value={form.infra_mode}
              onChange={(v) => set("infra_mode", v as FormState["infra_mode"])}
              options={[
                { value: "unknown", label: "Unsure" },
                { value: "plug_and_play", label: "Plug and play — works with what's there" },
                { value: "moderate", label: "Moderate — some setup or integration" },
                { value: "heavy", label: "Heavy — significant infrastructure required" },
              ]}
            />
          </Field>
        </Section>

        <Section title="Affiliations" subtitle="Universities, accelerators, research institutes, or government labs.">
          <TriRadio
            name="aff"
            value={form.aff_mode}
            onChange={(v) => set("aff_mode", v as FormState["aff_mode"])}
            options={[
              { value: "unknown", label: "Prefer not to say" },
              { value: "none", label: "No institutional affiliations (confirmed)" },
              { value: "some", label: "Yes — we have affiliations" },
            ]}
          />
          {form.aff_mode === "some" && (
            <div className="space-y-3">
              {form.affiliations.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                  <input
                    className={inputCls}
                    placeholder="Organization name"
                    value={a.org_name}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        affiliations: f.affiliations.map((x, j) => (j === i ? { ...x, org_name: e.target.value } : x)),
                      }))
                    }
                  />
                  <select
                    className={inputCls}
                    value={a.org_type}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        affiliations: f.affiliations.map((x, j) => (j === i ? { ...x, org_type: e.target.value } : x)),
                      }))
                    }
                  >
                    {ORG_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                  </select>
                  <select
                    className={inputCls}
                    value={a.relationship}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        affiliations: f.affiliations.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)),
                      }))
                    }
                  >
                    {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                  </select>
                  <button
                    aria-label="Remove affiliation"
                    className="px-2 text-sm text-ink-faint hover:text-err"
                    onClick={() => setForm((f) => ({ ...f, affiliations: f.affiliations.filter((_, j) => j !== i) }))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="text-sm text-forest underline underline-offset-2"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    affiliations: [...f.affiliations, { org_name: "", org_type: "university", relationship: "cohort" }],
                  }))
                }
              >
                Add affiliation
              </button>
            </div>
          )}
        </Section>

        <Section title="Extras">
          <Field label="Pitch deck URL (optional)">
            <input className={inputCls} value={form.pitch_deck_url} onChange={(e) => set("pitch_deck_url", e.target.value)} />
          </Field>
        </Section>

        {error && <p className="text-sm text-err">{error}</p>}

        <div className="border-t border-line pt-6">
          <button
            onClick={onSubmit}
            disabled={busy || !form.name.trim() || !form.website.trim()}
            className="bg-forest px-7 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit for review"}
          </button>
          <p className="mt-3 text-xs text-ink-faint">
            Submissions are reviewed by the team before entering the matching pool.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Claim flow ──────────────────────────────────────────────────────────

function ClaimView({ website }: { website: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code" | "claimed">("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(path: string, body: Record<string, string>, next: () => void) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise border border-line bg-surface p-8">
      <h1 className="font-display text-3xl tracking-tight text-ink">
        This company is already listed.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
        We found this domain in our research pool. If it's yours, claim the
        profile: we'll send a verification code to an email address on the
        company domain, and once verified you can keep the profile accurate.
      </p>

      {stage === "email" && (
        <div className="mt-6">
          <label className={labelCls}>Work email on the company domain</label>
          <div className="mt-2 flex gap-3">
            <input
              className={inputCls}
              type="email"
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              onClick={() => call("/api/claim/start", { website, email }, () => setStage("code"))}
              disabled={busy || !email.trim()}
              className="shrink-0 bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
            >
              Send code
            </button>
          </div>
        </div>
      )}

      {stage === "code" && (
        <div className="mt-6">
          <p className="text-sm text-ink-secondary">
            If that address can receive mail for this domain, a 6-digit code is
            on its way. It expires in 15 minutes.
          </p>
          <div className="mt-3 flex gap-3">
            <input
              className={`${inputCls} tabular-nums`}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button
              onClick={() => call("/api/claim/verify", { website, email, code }, () => setStage("claimed"))}
              disabled={busy || code.length !== 6}
              className="shrink-0 bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
            >
              Verify
            </button>
          </div>
        </div>
      )}

      {stage === "claimed" && (
        <div className="mt-6 border-t border-line pt-6">
          <p className="text-sm font-medium text-forest-deep">
            Profile claimed.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            You're on record as this company's contact. The review team will
            reach out through this address, and profile corrections can be
            requested any time.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-err">{error}</p>}
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────

function Section({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative border-t border-line pt-6">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chips({ options, selected, onToggle }: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            className={`border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              active
                ? "border-forest bg-forest-tint text-forest-deep"
                : "border-line bg-surface text-ink-secondary hover:border-line-strong"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function TriRadio({ name, value, onChange, options }: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="h-3.5 w-3.5 accent-[var(--color-forest)]"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
