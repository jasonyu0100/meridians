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

      {/* Reality's rulings, read as a BENCH LEDGER rather than tiled cards: the
          telling + reasoning are full paragraphs, so each ruling gets a full-width
          row where the prose can breathe (the card grid clipped them). Skinned with
          the app's own dark tokens so it blends into the UI; a sky ruling-rail marks
          the margin, the matter (question) heads it, the RULING is the headline
          result, and the opinion + rationale read as editable fields that auto-grow
          to their content — nothing is ever clipped. */}
      <div className="flex flex-col gap-3">
        {items.map((it, i) => (
          <div
            key={it.id}
            className="relative overflow-hidden rounded-2xl border border-sky-400/15 bg-sky-500/4 py-4 pl-6 pr-5"
          >
            {/* The ruling-rail — a sky margin down the left edge. */}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-linear-to-b from-sky-400/70 to-sky-500/20" />

            {/* Numbered eyebrow + the closure status (does the matter settle?). */}
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-sky-300/80">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/15 font-mono text-[9px] tabular-nums text-sky-200">{i + 1}</span>
                Reality&apos;s verdict
              </span>
              <button
                onClick={() => onEdit(it.id, { closes: !it.closes })}
                title={it.closes ? "This verdict closes the question" : "The question stays open after this"}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
                  it.closes
                    ? "bg-rose-500/20 text-rose-300"
                    : "border border-white/10 text-text-dim hover:text-text-secondary"
                }`}
              >
                {it.closes ? "✕ closes the matter" : "stays open"}
              </button>
            </div>

            {/* The matter before the judge. */}
            <p className="mt-2 text-[14px] font-semibold leading-snug text-text-primary">{it.question}</p>

            {/* The ruling — the headline result the continuation will honour. */}
            <div className="mt-2.5 flex items-baseline gap-2.5 rounded-lg bg-emerald-500/10 px-3 py-2">
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-300/70">Ruling</span>
              <span className="text-[13px] font-semibold leading-snug text-emerald-300">→ {it.outcome}</span>
            </div>

            {/* The opinion — what actually happens. Full-width prose, auto-growing
                so the whole telling is always legible (no clipped scroll-boxes). */}
            <div className="mt-3">
              <span className="text-[10px] font-medium uppercase tracking-wider text-sky-300/70">What actually happens</span>
              <textarea
                value={it.telling}
                onChange={(e) => onEdit(it.id, { telling: e.target.value })}
                rows={3}
                className="mt-1 block w-full resize-none rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[13px] leading-relaxed text-text-primary outline-none transition field-sizing-content hover:border-white/15 focus:border-sky-400/40"
              />
            </div>

            {/* The rationale — why it resolves this way. Secondary, but just as
                readable; also auto-growing. */}
            <div className="mt-2.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-dim/70">Why it resolves this way</span>
              <textarea
                value={it.reasoning}
                onChange={(e) => onEdit(it.id, { reasoning: e.target.value })}
                rows={2}
                className="mt-1 block w-full resize-none rounded-lg border border-white/8 bg-black/15 px-3 py-2 text-[12.5px] leading-relaxed text-text-secondary outline-none transition field-sizing-content hover:border-white/15 focus:border-sky-400/40"
              />
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 && <p className="text-center text-[12px] text-text-dim/50">No executive outcomes to interpret.</p>}
    </div>
  );
}
