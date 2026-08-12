import { requireOfficer } from "@/lib/server/auth";
import { saveConfig } from "../actions";
import { PageTitle } from "../bits";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const { sb } = await requireOfficer();
  const { data: config, error } = await sb
    .from("scoring_config")
    .select("*")
    .single();
  if (error || !config) throw new Error(error?.message ?? "config missing");

  const inputCls =
    "w-full border border-line bg-surface px-3 py-2 font-mono text-sm tabular-nums focus:border-forest focus:outline-none";

  const num = (name: string, label: string, value: number, step = 0.01) => (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-ink-secondary">
        {label}
      </label>
      <input
        name={name}
        type="number"
        step={step}
        defaultValue={value}
        className={`mt-1.5 ${inputCls}`}
      />
    </div>
  );

  return (
    <div>
      <PageTitle
        title="Scoring config"
        sub="One source of truth for every weight and threshold. Re-run matching after changes — scores refresh, statuses stay."
      />

      <form action={saveConfig} className="mt-8 max-w-2xl space-y-8">
        <section className="border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Similarity</h2>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {num("similarity_threshold", "Threshold (cosine)", Number(config.similarity_threshold))}
            {num("adjacent_candidate_limit", "Adjacent candidates shown", config.adjacent_candidate_limit, 1)}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Calibrated on the seed matrix: intended pairs sit at 0.58-0.62,
            best non-intended at 0.49. Move with care.
          </p>
        </section>

        <section className="border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Final score weights</h2>
          <p className="mt-1 text-xs text-ink-faint">Must sum to 1.00. Evidence weights renormalize over what's known; the partnership weight never does.</p>
          <div className="mt-4 grid grid-cols-4 gap-4">
            {num("weight_similarity", "Similarity", Number(config.weight_similarity))}
            {num("weight_readiness", "Readiness", Number(config.weight_readiness))}
            {num("weight_context", "Context", Number(config.weight_context))}
            {num("weight_strategic", "Partnership", Number(config.weight_strategic))}
          </div>
        </section>

        <section className="border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Partnership priority</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            Country weights applied to HQ country only. Displayed everywhere as
            "Partnership priority" — never as a badge on a startup.
          </p>
          <textarea
            name="country_weights"
            defaultValue={JSON.stringify(config.country_weights, null, 2)}
            className={`mt-3 min-h-32 ${inputCls}`}
          />
        </section>

        <div className="flex items-center gap-4">
          <button className="bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep">
            Save config
          </button>
          <p className="text-xs text-ink-faint">
            Readiness and context sub-weights are config too — editable via
            SQL for now; surfacing them here is a polish-phase item.
          </p>
        </div>
      </form>
    </div>
  );
}
