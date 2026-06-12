/** RealismReview — the GM's editable view of the realism preprocessing, shared
 *  IDENTICALLY by the narrative merge UI (StreamsView "Preprocess reality" step)
 *  and the Conviction game (the showdown review popup). The impartial judge has
 *  interpreted what each committed outcome actually does; here the GM tweaks the
 *  telling (what happens), the reasoning (why), and the closure (does it settle
 *  the question), or re-prompts the judge with a steer. Purely presentational —
 *  the caller owns the data + the re-run + the commit. */
"use client";

export interface RealismItem {
  id: string;
  /** The open question / contested topic. */
  question: string;
  /** The committed outcome that reality resolves around (read-only here). */
  outcome: string;
  telling: string;
  reasoning: string;
  closes: boolean;
}

export function RealismReview({
  items,
  onEdit,
  guidance,
  onGuidanceChange,
  onReRun,
  busy,
  error,
  thinking,
}: {
  items: RealismItem[];
  onEdit: (id: string, patch: Partial<RealismItem>) => void;
  guidance: string;
  onGuidanceChange: (v: string) => void;
  onReRun: () => void;
  busy: boolean;
  error?: string | null;
  /** The judge's live reasoning, streamed while busy — shows the thinking. */
  thinking?: string;
}) {
  return (
    <div className="space-y-4">
      {/* Identity banner — frames this as the auditable preprocessing PHASE that
          runs BEFORE generation, identical wherever it appears. */}
      <div className="rounded-xl border border-sky-400/25 bg-sky-500/6 p-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-[11px] text-sky-200">✦</span>
          <span className="text-[13px] font-semibold text-sky-100">Realism check — preprocessing before generation</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-dim/70">
          An impartial judge resolves what each committed outcome <em className="text-text-secondary not-italic">actually does</em> in
          the world — so the continuation is <span className="text-sky-300/80">guided</span> by a clear call, and the reasoning stays{" "}
          <span className="text-sky-300/80">auditable</span> afterwards. Tweak it below, or steer the judge and re-run, then continue to generate.
        </p>
      </div>

      {/* Steer + re-run the realism pass (prompt-driven editing). */}
      <div className="flex items-center gap-2 rounded-lg border border-sky-400/20 bg-sky-500/5 p-2.5">
        <span className="shrink-0 text-[11px] uppercase tracking-wider text-sky-300/70">Steer</span>
        <input
          value={guidance}
          onChange={(e) => onGuidanceChange(e.target.value)}
          placeholder="Steer the judgment, then re-run (e.g. 'treat the oath as binding')…"
          className="flex-1 rounded border border-white/10 bg-bg-field/60 px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-sky-400/40"
        />
        <button
          onClick={onReRun}
          disabled={busy}
          className="shrink-0 rounded-lg border border-sky-400/30 px-3 py-1.5 text-[12px] text-sky-200 transition hover:bg-sky-500/10 disabled:opacity-50"
        >
          {busy ? "Re-running…" : "↻ Re-run judge"}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400/80">{error}</p>}
      {/* The judge thinking out loud while it (re-)resolves — the same auditable
          reasoning shown during the preprocessing transition. */}
      {busy && (
        <div className="rounded-lg border border-sky-400/20 bg-sky-500/4 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" /> Thinking
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
            {thinking || 'Reading the world and weighing the committed outcomes…'}
          </p>
        </div>
      )}

      {items.map((it) => (
        <div key={it.id} className="space-y-2.5 rounded-xl border border-white/10 bg-white/2 p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-text-primary">{it.question}</span>
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300/90">→ {it.outcome}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-sky-300/70">Telling — what actually happens</span>
            <textarea
              value={it.telling}
              onChange={(e) => onEdit(it.id, { telling: e.target.value })}
              rows={2}
              className="mt-1 w-full resize-y rounded border border-white/10 bg-bg-field/60 px-2.5 py-1.5 text-[12px] leading-snug text-text-primary outline-none focus:border-sky-400/40"
            />
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-text-dim/60">Reasoning — why</span>
            <textarea
              value={it.reasoning}
              onChange={(e) => onEdit(it.id, { reasoning: e.target.value })}
              rows={2}
              className="mt-1 w-full resize-y rounded border border-white/10 bg-bg-field/60 px-2.5 py-1.5 text-[12px] leading-snug text-text-secondary outline-none focus:border-white/30"
            />
          </div>
          <button
            onClick={() => onEdit(it.id, { closes: !it.closes })}
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
              it.closes ? "bg-rose-500/20 text-rose-300" : "border border-white/10 text-text-dim hover:text-text-secondary"
            }`}
          >
            {it.closes ? "closes the question" : "stays open"}
          </button>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-[12px] text-text-dim/50">No executive outcomes to interpret.</p>}
    </div>
  );
}
