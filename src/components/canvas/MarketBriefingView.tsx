'use client';

/**
 * Market Briefing — generative read of the prediction-market portfolio plus
 * two parallel slates the operator can mix and match into composed
 * directions:
 *
 *   - arc directions   → composed → settings.storyDirection / Generate Arc CTA
 *   - world directions → composed → settings.worldDirection / Expand World CTA
 *
 * Both systems use the same UI shape: a horizontal carousel of selectable
 * cards, a composer with selected-chips + an editable textarea + Apply (saves
 * to story settings), and a CTA that opens the GeneratePanel in the relevant
 * tab pre-populated with the composed text.
 *
 * Aesthetic stays minimalist — clean type, light borders, no chrome.
 */

import { useCallback, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  generateMarketBriefing,
  type SuggestedMove,
  type WorldExpansion,
} from '@/lib/ai/market-brief';
import type { MovePriority, MoveType, ExpansionKind } from '@/lib/prompts/briefing';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { sceneOrdinalAt, countScenes } from '@/lib/narrative-utils';

// ── Visual taxonomy ────────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<MovePriority, { label: string; color: string; dot: string }> = {
  high: { label: 'High', color: 'text-rose-300', dot: 'bg-rose-400' },
  medium: { label: 'Medium', color: 'text-amber-300', dot: 'bg-amber-400' },
  low: { label: 'Low', color: 'text-sky-300', dot: 'bg-sky-400' },
};

const MOVE_TYPE_LABEL: Record<MoveType, string> = {
  open: 'Open',
  escalate: 'Escalate',
  subvert: 'Subvert',
  foreshadow: 'Foreshadow',
  redirect: 'Redirect',
  consolidate: 'Consolidate',
  release: 'Release',
  destabilise: 'Destabilise',
  sustain: 'Sustain',
};

const EXPANSION_KIND_LABEL: Record<ExpansionKind, string> = {
  character: 'Character',
  location: 'Location',
  artifact: 'Artifact',
  thread: 'Thread',
  system: 'System',
};

// ── Main view ──────────────────────────────────────────────────────────────

export default function MarketBriefingView() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const activeBranchId = state.viewState.activeBranchId;

  // Briefings are always generated against the head of the branch (the last
  // resolved key). Even if the operator scrubbed back to read an earlier
  // scene, the brief reads the current state of the portfolio.
  const headIndex = resolvedKeys.length - 1;

  // Persisted briefing lives on the narrative — hydrate from there so the
  // brief survives tab switches and reloads. Local state holds in-flight
  // loading, streaming reasoning, and editor overrides only.
  const persisted = narrative?.lastBriefing ?? null;
  const briefing = persisted?.briefing ?? null;
  const briefingTimestamp = persisted?.timestamp ?? null;
  const briefingScene = persisted?.sceneIndex ?? null;
  const briefingBranchId = persisted?.branchId ?? null;
  const branchChanged = briefingBranchId !== null && briefingBranchId !== activeBranchId;

  const [loading, setLoading] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Multi-select state per system. Order preserved (selection order =
  // composition order in the directive).
  const [selectedArcIndices, setSelectedArcIndices] = useState<number[]>([]);
  const [selectedWorldIndices, setSelectedWorldIndices] = useState<number[]>([]);
  const [arcEditorOverride, setArcEditorOverride] = useState<string | null>(null);
  const [worldEditorOverride, setWorldEditorOverride] = useState<string | null>(null);

  const currentStoryDirection = narrative?.storySettings?.storyDirection?.trim() ?? '';
  const currentWorldDirection = narrative?.storySettings?.worldDirection?.trim() ?? '';

  const runBriefing = useCallback(async () => {
    if (!narrative || !activeBranchId) return;
    const targetHead = resolvedKeys.length - 1;
    setLoading(true);
    setError(null);
    setReasoning('');
    try {
      const result = await generateMarketBriefing({
        narrative,
        resolvedKeys,
        currentSceneIndex: targetHead,
        onReasoning: (token) => setReasoning((prev) => prev + token),
      });
      dispatch({
        type: 'SET_BRIEFING',
        briefing: {
          briefing: result,
          branchId: activeBranchId,
          sceneIndex: targetHead,
          timestamp: Date.now(),
        },
      });
      setSelectedArcIndices([]);
      setSelectedWorldIndices([]);
      setArcEditorOverride(null);
      setWorldEditorOverride(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [narrative, resolvedKeys, activeBranchId, dispatch]);

  const toggleArc = (index: number) => {
    setSelectedArcIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
    setArcEditorOverride(null);
  };

  const toggleWorld = (index: number) => {
    setSelectedWorldIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
    setWorldEditorOverride(null);
  };

  const composedArcDirection = useMemo(() => {
    if (arcEditorOverride !== null) return arcEditorOverride;
    if (!briefing) return '';
    return selectedArcIndices
      .map((i) => briefing.moves[i]?.direction ?? '')
      .filter((d) => d.length > 0)
      .join(' ');
  }, [briefing, selectedArcIndices, arcEditorOverride]);

  const composedWorldDirection = useMemo(() => {
    if (worldEditorOverride !== null) return worldEditorOverride;
    if (!briefing) return '';
    return selectedWorldIndices
      .map((i) => briefing.expansions[i]?.direction ?? '')
      .filter((d) => d.length > 0)
      .join(' ');
  }, [briefing, selectedWorldIndices, worldEditorOverride]);

  const applyArcDirection = () => {
    if (!narrative) return;
    const settings = {
      ...DEFAULT_STORY_SETTINGS,
      ...narrative.storySettings,
      storyDirection: composedArcDirection.trim(),
    };
    dispatch({ type: 'SET_STORY_SETTINGS', settings });
    setSelectedArcIndices([]);
    setArcEditorOverride(null);
  };

  const applyWorldDirection = () => {
    if (!narrative) return;
    const settings = {
      ...DEFAULT_STORY_SETTINGS,
      ...narrative.storySettings,
      worldDirection: composedWorldDirection.trim(),
    };
    dispatch({ type: 'SET_STORY_SETTINGS', settings });
    setSelectedWorldIndices([]);
    setWorldEditorOverride(null);
  };

  const clearArc = () => {
    setSelectedArcIndices([]);
    setArcEditorOverride('');
  };

  const clearWorld = () => {
    setSelectedWorldIndices([]);
    setWorldEditorOverride('');
  };

  const generateArc = () => {
    window.dispatchEvent(
      new CustomEvent('open-generate-panel', {
        detail: { continuationMode: true, storyDirection: composedArcDirection.trim() },
      }),
    );
  };

  const expandWorld = () => {
    window.dispatchEvent(
      new CustomEvent('open-generate-panel', {
        detail: { worldMode: true, worldDirection: composedWorldDirection.trim() },
      }),
    );
  };

  if (!narrative) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[11px] text-text-dim">
        Select a narrative to brief.
      </div>
    );
  }

  const headSceneOrdinal = Math.max(1, sceneOrdinalAt(narrative, resolvedKeys, headIndex));
  const sceneTotal = countScenes(narrative, resolvedKeys);
  // Scene ordinal + drift only meaningful when brief was generated against
  // the currently-active branch. If the operator switched branches, surface
  // that as the staleness signal instead of a misleading ordinal diff.
  const briefingSceneOrdinal =
    briefingScene !== null && !branchChanged
      ? Math.max(1, sceneOrdinalAt(narrative, resolvedKeys, briefingScene))
      : null;
  const scenesSinceBriefing =
    briefingScene !== null && !branchChanged ? Math.max(0, headIndex - briefingScene) : null;

  return (
    <div className="h-full w-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col gap-6">
        <Header
          headline={briefing?.headline ?? ''}
          loading={loading}
          onRun={runBriefing}
          hasBriefing={!!briefing}
          headSceneOrdinal={headSceneOrdinal}
          sceneTotal={sceneTotal}
          briefingSceneOrdinal={briefingSceneOrdinal}
          scenesSinceBriefing={scenesSinceBriefing}
          branchChanged={branchChanged}
          timestamp={briefingTimestamp}
        />

        {error && (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        {(loading || (reasoning && !briefing)) && (
          <div className="max-w-2xl mx-auto px-8 pt-6 pb-32 w-full">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                {loading ? 'Generating brief...' : 'Reasoning'}
              </span>
            </div>
            {reasoning && (
              <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {!briefing && !loading && !error && <EmptyState onRun={runBriefing} />}

        {briefing && (
          <>
            {briefing.situation && (
              <Section title="Situation"><Prose text={briefing.situation} /></Section>
            )}

            {briefing.watch.length > 0 && (
              <Section title="Watch">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {briefing.watch.map((w, i) => (
                    <WatchCard key={i} title={w.title} analysis={w.analysis} />
                  ))}
                </div>
              </Section>
            )}

            {briefing.moves.length > 0 && (
              <Section
                title="Arc directions"
                hint={`${String(briefing.moves.length).padStart(2, '0')} ITEMS · ${String(selectedArcIndices.length).padStart(2, '0')} STACKED`}
              >
                <ArcCarousel
                  moves={briefing.moves}
                  selected={selectedArcIndices}
                  onToggle={toggleArc}
                />
              </Section>
            )}

            <Composer
              accent="emerald"
              title="Story direction"
              subtitle="Composed from arc directions · steers next scene generation"
              composed={composedArcDirection}
              currentValue={currentStoryDirection}
              selectedLabels={selectedArcIndices.map((i) => briefing.moves[i]?.label).filter(Boolean) as string[]}
              onEdit={(t) => setArcEditorOverride(t)}
              onClear={clearArc}
              onApply={applyArcDirection}
              ctaLabel="Generate Arc →"
              onCta={generateArc}
              ctaEnabled={composedArcDirection.trim().length > 0 || currentStoryDirection.length > 0}
            />

            {briefing.expansions.length > 0 && (
              <Section
                title="World directions"
                hint={`${String(briefing.expansions.length).padStart(2, '0')} ITEMS · ${String(selectedWorldIndices.length).padStart(2, '0')} STACKED`}
              >
                <WorldCarousel
                  expansions={briefing.expansions}
                  selected={selectedWorldIndices}
                  onToggle={toggleWorld}
                />
              </Section>
            )}

            <Composer
              accent="violet"
              title="World direction"
              subtitle="Composed from world directions · steers next world expansion"
              composed={composedWorldDirection}
              currentValue={currentWorldDirection}
              selectedLabels={selectedWorldIndices.map((i) => briefing.expansions[i]?.label).filter(Boolean) as string[]}
              onEdit={(t) => setWorldEditorOverride(t)}
              onClear={clearWorld}
              onApply={applyWorldDirection}
              ctaLabel="Expand World →"
              onCta={expandWorld}
              ctaEnabled={composedWorldDirection.trim().length > 0 || currentWorldDirection.length > 0}
            />

            {(briefing.outlook.nearTerm || briefing.outlook.phaseEnd) && (
              <Section title="Outlook">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {briefing.outlook.nearTerm && (
                    <OutlookCard label="Next ~3 scenes" body={briefing.outlook.nearTerm} />
                  )}
                  {briefing.outlook.phaseEnd && (
                    <OutlookCard label="End of phase" body={briefing.outlook.phaseEnd} />
                  )}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({
  headline,
  loading,
  onRun,
  hasBriefing,
  headSceneOrdinal,
  sceneTotal,
  briefingSceneOrdinal,
  scenesSinceBriefing,
  branchChanged,
  timestamp,
}: {
  headline: string;
  loading: boolean;
  onRun: () => void;
  hasBriefing: boolean;
  headSceneOrdinal: number;
  sceneTotal: number;
  briefingSceneOrdinal: number | null;
  scenesSinceBriefing: number | null;
  branchChanged: boolean;
  timestamp: number | null;
}) {
  const stamp = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const headMoved = scenesSinceBriefing !== null && scenesSinceBriefing > 0;
  const stale = headMoved || branchChanged;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 text-[10px] text-text-dim flex-wrap">
          <span>Briefing</span>
          <span className="text-text-dim/40">·</span>
          {hasBriefing && briefingSceneOrdinal !== null ? (
            <>
              <span className="font-mono tabular-nums">
                generated for scene {briefingSceneOrdinal} of {sceneTotal}
              </span>
              {headMoved && (
                <>
                  <span className="text-text-dim/40">·</span>
                  <span className="font-mono tabular-nums text-amber-300/80">
                    head moved +{scenesSinceBriefing}
                  </span>
                </>
              )}
            </>
          ) : hasBriefing && branchChanged ? (
            <span className="font-mono tabular-nums text-amber-300/80">generated on a different branch</span>
          ) : (
            <span className="font-mono tabular-nums">head at scene {headSceneOrdinal} of {sceneTotal}</span>
          )}
          {stamp && (
            <>
              <span className="text-text-dim/40">·</span>
              <span className="font-mono tabular-nums">{stamp}</span>
            </>
          )}
        </div>
        {headline ? (
          <p className="text-[14px] text-text-primary leading-snug">{headline}</p>
        ) : loading ? (
          <p className="text-[12px] text-text-dim italic">Reading the board…</p>
        ) : (
          <p className="text-[12px] text-text-dim">No briefing yet — generate one to read the board.</p>
        )}
      </div>
      <button
        onClick={onRun}
        disabled={loading}
        className="shrink-0 text-[11px] px-3 py-1.5 rounded-md border border-white/10 hover:border-white/25 hover:bg-white/5 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Generating…' : hasBriefing ? (stale ? 'Refresh' : 'Regenerate') : 'Generate'}
      </button>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3 border-b border-white/5 pb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-text-dim/40" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">
            {title}
          </h3>
        </div>
        {hint && (
          <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim/70 font-mono tabular-nums">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">{text}</p>
  );
}

// ── Watch ──────────────────────────────────────────────────────────────────

function WatchCard({ title, analysis }: { title: string; analysis: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/2 p-3 flex flex-col gap-1.5">
      <h4 className="text-[11px] text-text-primary font-medium">{title}</h4>
      {analysis && (
        <p className="text-[11px] text-text-secondary leading-snug">{analysis}</p>
      )}
    </div>
  );
}

// ── Carousel chrome ────────────────────────────────────────────────────────
//
// Vertical playing-card format. Each card declares its sections from top to
// bottom: status strip → ID slot → title → target → rationale → directive.
// Corner brackets give the operations-panel feel without leaning on military
// terminology.

const CARD_WIDTH = 'w-52'; // 208px — playing-card aspect when paired with min-h
const CARD_MIN_HEIGHT = 'min-h-92'; // 368px

function CornerBrackets({ accent }: { accent: string }) {
  // Four corner ticks — pure presentational, no clicks. Coloured by accent so
  // selected cards pop against unselected.
  return (
    <>
      <span className="pointer-events-none absolute top-0 left-0 w-2.5 h-2.5 border-t border-l rounded-tl-md" style={{ borderColor: accent }} />
      <span className="pointer-events-none absolute top-0 right-0 w-2.5 h-2.5 border-t border-r rounded-tr-md" style={{ borderColor: accent }} />
      <span className="pointer-events-none absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l rounded-bl-md" style={{ borderColor: accent }} />
      <span className="pointer-events-none absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r rounded-br-md" style={{ borderColor: accent }} />
    </>
  );
}

// ── Arc carousel (story directions) ────────────────────────────────────────

function ArcCarousel({
  moves,
  selected,
  onToggle,
}: {
  moves: SuggestedMove[];
  selected: number[];
  onToggle: (i: number) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory">
      {moves.map((m, i) => (
        <ArcCard
          key={`${m.label}-${i}`}
          move={m}
          index={i + 1}
          total={moves.length}
          selected={selectedSet.has(i)}
          selectionOrder={selectedSet.has(i) ? selected.indexOf(i) + 1 : null}
          onClick={() => onToggle(i)}
        />
      ))}
    </div>
  );
}

function ArcCard({
  move,
  index,
  total,
  selected,
  selectionOrder,
  onClick,
}: {
  move: SuggestedMove;
  index: number;
  total: number;
  selected: boolean;
  selectionOrder: number | null;
  onClick: () => void;
}) {
  const pri = PRIORITY_STYLE[move.priority];
  const bracketColor = selected ? 'rgba(52, 211, 153, 0.5)' : 'rgba(255, 255, 255, 0.12)';

  return (
    <button
      onClick={onClick}
      className={`group relative snap-start shrink-0 ${CARD_WIDTH} ${CARD_MIN_HEIGHT} text-left flex flex-col rounded-md border transition-colors ${
        selected
          ? 'border-emerald-400/40 bg-emerald-500/5'
          : 'border-white/8 bg-white/2 hover:border-white/20 hover:bg-white/4'
      }`}
    >
      <CornerBrackets accent={bracketColor} />

      {/* Status strip — priority + slot index */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${pri.dot}`} />
          <span className={`text-[9px] uppercase tracking-[0.2em] font-mono ${pri.color}`}>
            {pri.label}
          </span>
        </div>
        <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim/60 font-mono tabular-nums">
          {String(index).padStart(2, '0')}/{String(total).padStart(2, '0')}
        </span>
      </div>

      {/* Type + selection badge */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim font-mono truncate">
          {MOVE_TYPE_LABEL[move.moveType]}
        </span>
        {selected && selectionOrder !== null ? (
          <span className="w-4 h-4 rounded-sm bg-emerald-400 text-bg-base text-[9px] font-bold font-mono flex items-center justify-center tabular-nums">
            {selectionOrder}
          </span>
        ) : (
          <span className="w-4 h-4 rounded-sm border border-white/10 text-[9px] text-text-dim/40 font-mono flex items-center justify-center">
            ·
          </span>
        )}
      </div>

      {/* Title */}
      <div className="px-3 pt-1 pb-2">
        <h3 className="text-[13px] text-text-primary font-medium leading-tight">
          {move.label}
        </h3>
      </div>

      {/* Target */}
      {move.target && (
        <div className="px-3 pb-2">
          <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono">
            <span className="text-text-dim/50">target</span>
            <span className="text-text-secondary normal-case tracking-normal truncate" title={move.target}>
              {move.target}
            </span>
          </span>
        </div>
      )}

      {/* Rationale — body */}
      {move.rationale && (
        <div className="px-3 pb-2 flex-1">
          <p className="text-[11px] text-text-secondary leading-snug line-clamp-6">
            {move.rationale}
          </p>
        </div>
      )}

      {/* Directive — pinned footer */}
      <div className="mx-3 mb-3 mt-auto rounded-sm border border-white/8 bg-bg-elevated/60 p-2">
        <span className="text-[8px] uppercase tracking-[0.2em] text-text-dim/60 font-mono block mb-1">
          Direction
        </span>
        <p className="text-[10.5px] text-text-secondary leading-snug italic line-clamp-4">
          {move.direction}
        </p>
      </div>
    </button>
  );
}

// ── World carousel (world directions) ──────────────────────────────────────

function WorldCarousel({
  expansions,
  selected,
  onToggle,
}: {
  expansions: WorldExpansion[];
  selected: number[];
  onToggle: (i: number) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory">
      {expansions.map((e, i) => (
        <WorldCard
          key={`${e.label}-${i}`}
          expansion={e}
          index={i + 1}
          total={expansions.length}
          selected={selectedSet.has(i)}
          selectionOrder={selectedSet.has(i) ? selected.indexOf(i) + 1 : null}
          onClick={() => onToggle(i)}
        />
      ))}
    </div>
  );
}

function WorldCard({
  expansion,
  index,
  total,
  selected,
  selectionOrder,
  onClick,
}: {
  expansion: WorldExpansion;
  index: number;
  total: number;
  selected: boolean;
  selectionOrder: number | null;
  onClick: () => void;
}) {
  const bracketColor = selected ? 'rgba(167, 139, 250, 0.5)' : 'rgba(255, 255, 255, 0.12)';

  return (
    <button
      onClick={onClick}
      className={`group relative snap-start shrink-0 ${CARD_WIDTH} ${CARD_MIN_HEIGHT} text-left flex flex-col rounded-md border transition-colors ${
        selected
          ? 'border-violet-400/40 bg-violet-500/5'
          : 'border-white/8 bg-white/2 hover:border-white/20 hover:bg-white/4'
      }`}
    >
      <CornerBrackets accent={bracketColor} />

      {/* Status strip — kind + slot index */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          <span className="text-[9px] uppercase tracking-[0.2em] text-violet-300 font-mono">
            {EXPANSION_KIND_LABEL[expansion.kind]}
          </span>
        </div>
        <span className="text-[9px] uppercase tracking-[0.15em] text-text-dim/60 font-mono tabular-nums">
          {String(index).padStart(2, '0')}/{String(total).padStart(2, '0')}
        </span>
      </div>

      {/* Selection badge */}
      <div className="flex items-center justify-end px-3 py-1.5">
        {selected && selectionOrder !== null ? (
          <span className="w-4 h-4 rounded-sm bg-violet-400 text-bg-base text-[9px] font-bold font-mono flex items-center justify-center tabular-nums">
            {selectionOrder}
          </span>
        ) : (
          <span className="w-4 h-4 rounded-sm border border-white/10 text-[9px] text-text-dim/40 font-mono flex items-center justify-center">
            ·
          </span>
        )}
      </div>

      {/* Title */}
      <div className="px-3 pt-1 pb-2">
        <h3 className="text-[13px] text-text-primary font-medium leading-tight">
          {expansion.label}
        </h3>
      </div>

      {/* Rationale — body */}
      {expansion.rationale && (
        <div className="px-3 pb-2 flex-1">
          <p className="text-[11px] text-text-secondary leading-snug line-clamp-6">
            {expansion.rationale}
          </p>
        </div>
      )}

      {/* Directive — pinned footer */}
      <div className="mx-3 mb-3 mt-auto rounded-sm border border-white/8 bg-bg-elevated/60 p-2">
        <span className="text-[8px] uppercase tracking-[0.2em] text-text-dim/60 font-mono block mb-1">
          Direction
        </span>
        <p className="text-[10.5px] text-text-secondary leading-snug italic line-clamp-4">
          {expansion.direction}
        </p>
      </div>
    </button>
  );
}

// ── Composer (shared between arc + world) ──────────────────────────────────

type Accent = 'emerald' | 'violet';

const ACCENT_STYLE: Record<Accent, {
  applyBorder: string;
  applyBg: string;
  applyHover: string;
  applyText: string;
  ctaBorder: string;
  ctaBg: string;
  ctaHover: string;
  ctaText: string;
  focus: string;
}> = {
  emerald: {
    applyBorder: 'border-emerald-500/40',
    applyBg: 'bg-emerald-500/10',
    applyHover: 'hover:bg-emerald-500/20',
    applyText: 'text-emerald-200',
    ctaBorder: 'border-emerald-400/50',
    ctaBg: 'bg-emerald-400/15',
    ctaHover: 'hover:bg-emerald-400/25',
    ctaText: 'text-emerald-100',
    focus: 'focus:border-emerald-500/40',
  },
  violet: {
    applyBorder: 'border-violet-500/40',
    applyBg: 'bg-violet-500/10',
    applyHover: 'hover:bg-violet-500/20',
    applyText: 'text-violet-200',
    ctaBorder: 'border-violet-400/50',
    ctaBg: 'bg-violet-400/15',
    ctaHover: 'hover:bg-violet-400/25',
    ctaText: 'text-violet-100',
    focus: 'focus:border-violet-500/40',
  },
};

function Composer({
  accent,
  title,
  subtitle,
  composed,
  currentValue,
  selectedLabels,
  onEdit,
  onClear,
  onApply,
  ctaLabel,
  onCta,
  ctaEnabled,
}: {
  accent: Accent;
  title: string;
  subtitle: string;
  composed: string;
  currentValue: string;
  selectedLabels: string[];
  onEdit: (text: string) => void;
  onClear: () => void;
  onApply: () => void;
  ctaLabel: string;
  onCta: () => void;
  ctaEnabled: boolean;
}) {
  const dirty = composed.trim() !== currentValue;
  const canApply = composed.trim().length > 0 && dirty;
  const style = ACCENT_STYLE[accent];

  return (
    <div className="rounded-xl border border-white/10 bg-white/2 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="text-[11px] uppercase tracking-wider text-text-dim">{title}</h3>
          <span className="text-[10px] text-text-dim/70 truncate">{subtitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            disabled={composed === '' && selectedLabels.length === 0}
            className="text-[11px] px-2.5 py-1 rounded-md border border-white/10 hover:border-white/25 text-text-dim hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <button
            onClick={onApply}
            disabled={!canApply}
            className={`text-[11px] px-3 py-1 rounded-md border ${style.applyBorder} ${style.applyBg} ${style.applyHover} ${style.applyText} transition-colors disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            Apply
          </button>
        </div>
      </div>

      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedLabels.map((label, i) => (
            <span
              key={`${label}-${i}`}
              className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-white/3 text-text-secondary"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <textarea
        value={composed}
        onChange={(e) => onEdit(e.target.value)}
        placeholder={`Stack cards above to compose your ${title.toLowerCase()} — or write freehand. Apply commits to story settings.`}
        className={`w-full h-28 bg-bg-elevated/70 border border-white/8 rounded-lg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none ${style.focus} resize-none leading-relaxed`}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 text-[10px] text-text-dim/70 min-w-0">
          {currentValue ? (
            <>
              <span>Saved:</span>
              <span className="text-text-secondary truncate" title={currentValue}>
                {currentValue}
              </span>
            </>
          ) : (
            <span>No saved {title.toLowerCase()}.</span>
          )}
        </div>
        <button
          onClick={onCta}
          disabled={!ctaEnabled}
          className={`text-[11px] px-3 py-1 rounded-md border ${style.ctaBorder} ${style.ctaBg} ${style.ctaHover} ${style.ctaText} transition-colors disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

// ── Outlook ────────────────────────────────────────────────────────────────

function OutlookCard({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/2 p-3 flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-text-dim">{label}</span>
      <p className="text-[11px] text-text-secondary leading-relaxed">{body}</p>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ onRun }: { onRun: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-6 py-10 flex flex-col items-center gap-3">
      <p className="text-[12px] text-text-secondary text-center max-w-md">
        Read the current portfolio, then mix and match arc directions and world directions to compose
        the next move. Apply saves to story settings; the action buttons launch generation pre-filled.
      </p>
      <button
        onClick={onRun}
        className="text-[11px] px-3 py-1.5 rounded-md border border-white/15 hover:border-white/30 hover:bg-white/5 text-text-primary transition-colors"
      >
        Generate briefing
      </button>
    </div>
  );
}
