'use client';
// StreamsView — the Perspectives "Streams" tab. A Stream is a member's
// accumulating contribution against a perspective (replaces Issues + Requests).
// New-stream modal assigns the perspective pair (member → perspective) via
// avatars and find-or-creates the perspective. Filter by Open / Committed /
// Closed; commit or close inline; merge committed streams into a Merge.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/state/store';
import { type Stream, type PerspectiveKind, type ImageRef, type NarrativeState, type ProposedMerge } from '@/types/narrative';
import { IconMerge, IconTrash, IconCheck, IconChevronLeft, IconChevronDown, IconPlus, IconSparkle, IconClose, IconSignals, IconSearch } from '@/components/icons';
import { EmptyState } from '@/components/shared/EmptyState';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { Segmented } from '@/components/ui/Segmented';
import { InlineText } from '@/components/inspector/InlineEdit';
import { useImageUrlMap } from '@/hooks/useAssetUrl';
import { useActiveMember } from '@/hooks/useActiveMember';
import {
  StreamStateIcon, uid,
  Avatar, PerspectivePairBadge, perspectiveName, perspectiveEntity, memberName,
} from './RoomUI';
import { instantiateStream, scoreStreamPrior, suggestQuestion, suggestIntuition, suggestPrior, suggestBranchStream } from '@/lib/ai/streams';
import { streamsForBranch, mergesForBranch } from '@/lib/merges';
import { resolveAgentPersona, agentPersonaLabel, allAgents, resolveAgentById } from '@/lib/agents/personas';
import { openStream, applyStreamPrior, streamProbs, streamMargin, streamTrajectory, classifyStreamCategory } from '@/lib/forces/stream-stance';
import { normalizedEntropy } from '@/lib/forces/narrative-utils';
import { THREAD_CATEGORY_HEX, THREAD_CATEGORY_LABEL } from '@/lib/forces/thread-category';
import { outlineContext } from '@/lib/ai/context';
import { TrajectoryChart as TrajectoryChart_ } from '@/components/shared/charts';

type Vantage = { key: string; kind: PerspectiveKind; entityRef?: string; label: string; imageRef?: ImageRef; tier?: string };
type VantageTab = 'character' | 'location' | 'artifact';
const VANTAGE_TABS: VantageTab[] = ['character', 'location', 'artifact'];
// Tier order + labels per tab — the dividers in the "Developing perspective"
// picker. Each entity carries a tier (character role / location prominence /
// artifact significance); the Narrator is its own special tier under Character.
const VANTAGE_TIERS: Record<VantageTab, { key: string; label: string }[]> = {
  character: [
    { key: 'narrator', label: 'Narrator' },
    { key: 'anchor', label: 'Anchor' },
    { key: 'recurring', label: 'Recurring' },
    { key: 'transient', label: 'Transient' },
  ],
  location: [
    { key: 'domain', label: 'Domain' },
    { key: 'place', label: 'Place' },
    { key: 'margin', label: 'Margin' },
  ],
  artifact: [
    { key: 'key', label: 'Key' },
    { key: 'notable', label: 'Notable' },
    { key: 'minor', label: 'Minor' },
  ],
};
// Flat tier-key → label (e.g. 'anchor' → 'Anchor') and tier-key → sort rank,
// derived from VANTAGE_TIERS so the picker rows sort + label consistently.
const TIER_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(VANTAGE_TIERS).flat().map((t) => [t.key, t.label]),
);
const TIER_RANK: Record<string, number> = Object.fromEntries(
  Object.values(VANTAGE_TIERS).flatMap((tiers) => tiers.map((t, i) => [t.key, i])),
);

export function StreamsView() {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;
  // Active member presets the contributor for a new stream (set in Members).
  const { memberId: activeMemberId } = useActiveMember();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [intuition, setIntuition] = useState('');
  const [memberId, setMemberId] = useState(activeMemberId ?? '');
  // The new-stream contributor can be a real member or an AI player (agent).
  const [actorTab, setActorTab] = useState<'members' | 'agents'>('members');
  // Free-text filter over the contributor picker — matches member/agent name.
  const [actorQuery, setActorQuery] = useState('');
  const [agentId, setAgentId] = useState('');
  const [vantageKey, setVantageKey] = useState('');
  const [vantageTab, setVantageTab] = useState<VantageTab>('character');
  // Free-text filter over the perspective picker — matches entity name across
  // every tier in the active tab.
  const [vantageQuery, setVantageQuery] = useState('');
  // Collapse-on-select: each picker shows its full search/list while choosing,
  // then folds to a compact chosen-row (with "Change") once a pick is made —
  // so the two-step pair reads fast at a glance, expands only on demand.
  const [actorOpen, setActorOpen] = useState(!activeMemberId);
  const [vantageOpen, setVantageOpen] = useState(true);
  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  // Two independent suggesters — one per field — so the member can ask for a
  // question, then an intuition on that question, rather than a combo fill.
  const [suggestingQ, setSuggestingQ] = useState(false);
  const [suggestingI, setSuggestingI] = useState(false);
  // Commit review — per-stream final outcome the GM assigns before the merge.
  const [committing, setCommitting] = useState(false);
  const [mergeLabel, setMergeLabel] = useState('');
  // Per-stream committed outcome SET (length 1 = single clean resolution, the
  // default; length ≥ 2 = multi-resolution, the LLM reconciles them).
  const [resolutionDraft, setResolutionDraft] = useState<Record<string, string[]>>({});
  // RECORD-ONLY is derived, not a separate flag: a stream whose committed set is
  // EMPTY is folded into the merge for the organisational record only — no
  // executive decision, so it doesn't drive generation (it just tracks the final
  // prior distribution). 1+ committed outcomes ⇒ executive (drives generation).
  // Open streams selected for a one-shot commit + collapse into a merge.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Stream opened for detail (priors timeline), staying in this tab.
  const [viewId, setViewId] = useState<string | null>(null);

  const members = useMemo(() => Object.values(n?.members ?? {}), [n?.members]);
  const agents = useMemo(() => allAgents(n), [n]);
  // Branch-scoped: only streams visible on the active branch's lineage (owned
  // by it or an ancestor; legacy unstamped streams stay visible everywhere).
  const streams = useMemo(
    () => (n ? streamsForBranch(n, state.viewState.activeBranchId) : []),
    [n, state.viewState.activeBranchId],
  );
  // Vantages grouped by tab. Narrator is offered first, under Character.
  const vantagesByTab = useMemo<Record<VantageTab, Vantage[]>>(() => {
    const byTab: Record<VantageTab, Vantage[]> = { character: [], location: [], artifact: [] };
    if (!n) return byTab;
    byTab.character.push({ key: 'narrator', kind: 'narrator', label: 'Narrator', tier: 'narrator' });
    for (const c of Object.values(n.characters)) byTab.character.push({ key: `character:${c.id}`, kind: 'character', entityRef: c.id, label: c.name, imageRef: c.imageUrl, tier: c.role });
    for (const l of Object.values(n.locations)) byTab.location.push({ key: `location:${l.id}`, kind: 'location', entityRef: l.id, label: l.name, imageRef: l.imageUrl, tier: l.prominence });
    for (const a of Object.values(n.artifacts ?? {})) byTab.artifact.push({ key: `artifact:${a.id}`, kind: 'artifact', entityRef: a.id, label: a.name, imageRef: a.imageUrl, tier: a.significance });
    return byTab;
  }, [n]);
  const allVantages = useMemo(() => [...vantagesByTab.character, ...vantagesByTab.location, ...vantagesByTab.artifact], [vantagesByTab]);
  const vantageImages = useImageUrlMap(useMemo(() => allVantages.map((v) => v.imageRef).filter((r): r is string => !!r), [allVantages]));
  const selectedVantage = allVantages.find((v) => v.key === vantageKey);
  // The chosen contributor — a member or an agent (mutually exclusive). Picking
  // one clears the other so a stream is driven by exactly one actor.
  const selectedAgent = resolveAgentById(n, agentId);
  // Choosing an actor/vantage collapses its picker (and clears the sibling
  // actor kind so a stream is driven by exactly one contributor).
  const pickMember = (id: string) => { setMemberId(id); setAgentId(''); setActorOpen(false); };
  const pickAgent = (id: string) => { setAgentId(id); setMemberId(''); setActorOpen(false); };
  const pickVantage = (key: string) => { setVantageKey(key); setVantageOpen(false); };
  const actorName = memberId ? memberName(n?.members?.[memberId]) : selectedAgent ? (selectedAgent.name || 'Agent') : '';
  const hasActor = !!memberId || !!agentId;
  const numberOf = useMemo(() => {
    const m: Record<string, number> = {};
    [...streams].sort((a, b) => a.createdAt - b.createdAt).forEach((s, idx) => { m[s.id] = idx + 1; });
    return m;
  }, [streams]);
  const mergedIds = useMemo(() => {
    const set = new Set<string>();
    const visible = n ? mergesForBranch(n, state.viewState.activeBranchId) : [];
    for (const f of visible) (f.streamIds ?? []).forEach((id) => set.add(id));
    return set;
  }, [n, state.viewState.activeBranchId]);

  if (!n) return <EmptyState icon={IconSignals} title="No world view loaded." />;

  const viewing = viewId ? n.streams?.[viewId] ?? null : null;

  // Actively monitored (open) above the divider; committed & closed below
  // (committed first, then closed; each newest-first).
  const open = streams.filter((s) => s.state === 'open').sort((a, b) => b.updatedAt - a.updatedAt);
  const settled = streams
    .filter((s) => s.state !== 'open')
    .sort((a, b) => {
      const rank = { committed: 0, closed: 1 } as const;
      return (rank[a.state as 'committed' | 'closed'] - rank[b.state as 'committed' | 'closed']) || b.updatedAt - a.updatedAt;
    });
  const toggleSelect = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const selectedOpen = open.filter((s) => selected.has(s.id));

  const reset = () => { setTitle(''); setIntuition(''); setMemberId(activeMemberId ?? ''); setAgentId(''); setActorTab('members'); setActorQuery(''); setActorOpen(!activeMemberId); setVantageKey(''); setVantageQuery(''); setVantageOpen(true); setOpenErr(null); setStep(1); };
  const closeComposer = () => { setComposing(false); reset(); };

  // Branch from a stream — priors leading to a new line of thought. Opens the
  // new-stream modal at step 2 (NOT a direct create): the SAME perspective pair
  // is already chosen and the branching question + intuition are pre-seeded, so
  // the user reviews/edits them and opens the branch as its own stream, then
  // resolves it separately and returns to add the updated prior.
  const startBranch = (seed: { question: string; intuition?: string; memberId?: string; agentId?: string; perspectiveId: string }) => {
    const persp = n.perspectives?.[seed.perspectiveId];
    if (!persp) return;
    const vKey = persp.kind === 'narrator' ? 'narrator' : `${persp.kind}:${persp.entityRef}`;
    setTitle(seed.question);
    setIntuition(seed.intuition ?? '');
    setMemberId(seed.memberId ?? '');
    setAgentId(seed.agentId ?? '');
    setActorTab(seed.agentId ? 'agents' : 'members');
    setActorOpen(!(seed.memberId || seed.agentId));
    setVantageKey(vKey);
    setVantageTab(persp.kind === 'narrator' ? 'character' : persp.kind);
    setVantageOpen(false);
    setOpenErr(null);
    setStep(2);
    setViewId(null);
    setComposing(true);
  };

  const resolvePerspectiveId = (v: Vantage): string => {
    const existing = Object.values(n.perspectives ?? {}).find(
      (p) => p.kind === v.kind && (v.kind === 'narrator' ? true : p.entityRef === v.entityRef),
    );
    if (existing) return existing.id;
    const id = uid('persp');
    dispatch({ type: 'UPSERT_PERSPECTIVE', perspective: { id, kind: v.kind, entityRef: v.entityRef, agentId: agentId || undefined } });
    return id;
  };

  // Open a stream as a thread: AI seeds outcomes + priorProbs from the member's
  // intuition, then `openStream` derives the opening stance (the intuition is
  // stored as prior #1).
  const submit = async () => {
    const q = title.trim();
    const intu = intuition.trim();
    const v = selectedVantage;
    if (!q || !intu || !v || opening) return;
    setOpening(true);
    setOpenErr(null);
    try {
      const inst = await instantiateStream({ question: q, intuition: intu, perspectiveLabel: v.label, narrativeContext: headContext() });
      const perspectiveId = resolvePerspectiveId(v);
      const stream = openStream({
        perspectiveId,
        memberId: memberId || undefined,
        agentId: agentId || undefined,
        question: q,
        outcomes: inst.outcomes,
        priorProbs: inst.priorProbs,
        intuition: intu,
        intuitionLogType: inst.logType,
        horizon: inst.horizon,
        branchId: state.viewState.activeBranchId ?? undefined,
      });
      dispatch({ type: 'UPSERT_STREAM', stream });
      closeComposer();
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'Failed to open stream');
    } finally {
      setOpening(false);
    }
  };

  // Canonical narrative context at the HEAD — Vision always works off the
  // present head, not the scrubbed scene index.
  const headContext = () => outlineContext(n, state.resolvedEntryKeys, state.resolvedEntryKeys.length - 1);
  // The chosen perspective's OWN continuity — anchors suggestions on this
  // vantage rather than the narrative's protagonist.
  const entityContextOf = (v: Vantage | undefined) => {
    if (!v || v.kind === 'narrator' || !v.entityRef) return '';
    const ent = (v.kind === 'character' ? n.characters : v.kind === 'location' ? n.locations : n.artifacts)?.[v.entityRef];
    if (!ent) return '';
    // The entire inner world — full continuity drives nuanced, character-true thinking.
    const nodes = Object.values(ent.world?.nodes ?? {}).map((nd) => `- ${nd.content}`);
    return [`${ent.name} — what is true of this ${v.kind}:`, ...nodes].join('\n');
  };
  const suggestCtx = () => ({
    perspectiveLabel: selectedVantage?.label,
    entityContext: entityContextOf(selectedVantage),
    narrativeContext: headContext(),
    // When an agent drives the new stream, its persona shapes the suggestion.
    personaContext: resolveAgentPersona(selectedAgent) || undefined,
  });

  // Open questions already held against the chosen vantage — fed to the
  // question suggester so it proposes a DISTINCT uncertainty, not a rephrase.
  const existingQuestionsForVantage = (v: Vantage | undefined): string[] => {
    if (!v) return [];
    const persp = Object.values(n.perspectives ?? {}).find(
      (p) => p.kind === v.kind && (v.kind === 'narrator' ? true : p.entityRef === v.entityRef),
    );
    if (!persp) return [];
    return streams
      .filter((s) => s.perspectiveId === persp.id && s.state === 'open' && s.title.trim())
      .map((s) => s.title.trim());
  };

  // Suggest ONLY the open question, from the perspective's continuity.
  const handleSuggestQuestion = async () => {
    if (suggestingQ) return;
    setSuggestingQ(true);
    setOpenErr(null);
    try {
      const q = await suggestQuestion({
        ...suggestCtx(),
        existingQuestions: existingQuestionsForVantage(selectedVantage),
      });
      if (q) setTitle(q);
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'Suggestion failed');
    } finally {
      setSuggestingQ(false);
    }
  };

  // Suggest ONLY the intuition, grounded in the question already in the field.
  const handleSuggestIntuition = async () => {
    const q = title.trim();
    if (suggestingI || !q) return;
    setSuggestingI(true);
    setOpenErr(null);
    try {
      const intu = await suggestIntuition({ question: q, ...suggestCtx() });
      if (intu) setIntuition(intu);
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'Suggestion failed');
    } finally {
      setSuggestingI(false);
    }
  };

  // Close every selected open stream at once — the bulk cousin of the per-card
  // "Close stream" action. Leaves them in the list (closed, reopenable), clears
  // the selection.
  const closeSelected = () => {
    if (selectedOpen.length === 0) return;
    for (const s of selectedOpen) dispatch({ type: 'CLOSE_STREAM' as const, streamId: s.id });
    setSelected(new Set());
  };

  // Open the commit review — the GM assigns each selected stream's FINAL
  // outcome (defaulting to its stance leader) before the merge is recorded.
  const openCommitReview = () => {
    if (selectedOpen.length === 0) return;
    const init: Record<string, string[]> = {};
    for (const s of selectedOpen) {
      const outs = s.outcomes ?? [];
      const { topIdx } = streamMargin(s);
      const leader = outs[topIdx] ?? outs[0];
      init[s.id] = leader ? [leader] : [];
    }
    setResolutionDraft(init);
    setMergeLabel(`Committed ${selectedOpen.length} ${selectedOpen.length === 1 ? 'stream' : 'streams'}`);
    setCommitting(true);
  };

  // A merge is born from extending the narrative: build the proposed merge
  // (streams + GM-assigned final outcomes) and hand it to the Generate panel as
  // the locked continuity basis. The merge is only persisted (and its streams
  // committed) once a generation lands — see GeneratePanel.commitProposedMerge.
  const doCommit = () => {
    const streams = selectedOpen;
    if (streams.length === 0) return;
    const resolutions: Record<string, { outcome: string; outcomes?: string[]; overridden?: boolean }> = {};
    for (const s of streams) {
      const outs = s.outcomes ?? [];
      const { topIdx } = streamMargin(s);
      const leading = outs[topIdx];
      // The committed SET. EMPTY = record-only: the stream stays in the merge
      // (organisational record) with NO resolution, so it won't drive generation
      // — just tracks its final prior distribution. 1+ = an executive decision
      // (a single clean call, a different outcome = override, or several =
      // multi-resolution the LLM reconciles).
      const chosenSet = (resolutionDraft[s.id] ?? []).filter(Boolean);
      if (chosenSet.length === 0) continue; // record-only — no resolution entry
      const overridden = !!leading && !chosenSet.includes(leading);
      resolutions[s.id] = {
        outcome: chosenSet[0],
        ...(chosenSet.length > 1 ? { outcomes: chosenSet } : {}),
        overridden,
      };
    }
    const proposedMerge: ProposedMerge = {
      streamIds: streams.map((s) => s.id),
      label: mergeLabel.trim() || undefined,
      resolutions,
    };
    window.dispatchEvent(new CustomEvent('open-generate-panel', { detail: { proposedMerge } }));
    setSelected(new Set());
    setCommitting(false);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4">
        {viewing ? (
          <StreamDetail stream={viewing} number={numberOf[viewing.id]} onBack={() => setViewId(null)} onBranch={startBranch} />
        ) : (<>
        <header className="flex items-center gap-2 pb-2.5 mb-3 border-b border-white/5">
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-dim/80 font-medium">
            Streams <span className="text-text-dim/40 ml-0.5">{streams.length}</span>
          </span>
          <span className="text-[10px] text-text-dim/40">member contributions against a perspective</span>
          <button
            onClick={() => setComposing(true)}
            className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition"
          >
            New stream
          </button>
        </header>

        {streams.length === 0 ? (
          <EmptyState
            icon={IconSignals}
            title="No streams yet."
            hint="Open one against a perspective to start gathering priors."
          />
        ) : (
          <>
            {/* Actively monitored */}
            <div className="flex items-center gap-2 pb-2 text-[10px] uppercase tracking-[0.18em] text-text-dim/60">
              Actively monitored
              <span className="font-mono text-text-dim/40">{open.length}</span>
              {selectedOpen.length > 0 && (
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={closeSelected}
                    className="flex items-center gap-1.5 normal-case tracking-normal text-[11px] font-medium px-2.5 py-1 rounded-md border border-white/12 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                    title="Close the selected streams (they stay in the list and can be reopened)"
                  >
                    <IconClose size={12} /> Close {selectedOpen.length}
                  </button>
                  <button
                    onClick={openCommitReview}
                    className="flex items-center gap-1.5 normal-case tracking-normal text-[11px] font-medium px-2.5 py-1 rounded-md border border-purple-400/40 text-purple-200 bg-purple-500/10 hover:bg-purple-500/20 transition-colors"
                    title="Review and commit the selected streams' final outcomes"
                  >
                    <IconMerge size={12} /> Review &amp; commit {selectedOpen.length}
                  </button>
                </div>
              )}
            </div>
            <div className="relative space-y-0.5">
              {open.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/8 px-4 py-5 text-center text-[11px] text-text-dim/40 italic">
                  Nothing being monitored.
                </div>
              ) : (
                <>
                  <div className="absolute left-[6px] top-2 bottom-2 w-px bg-white/8" aria-hidden />
                  {open.map((s) => (
                    <StreamCard
                      key={s.id}
                      stream={s}
                      number={numberOf[s.id]}
                      merged={mergedIds.has(s.id)}
                      selected={selected.has(s.id)}
                      onToggleSelect={() => toggleSelect(s.id)}
                      onOpen={() => { setViewId(s.id); dispatch({ type: 'SET_INSPECTOR', context: { type: 'stream', streamId: s.id } }); }}
                    />
                  ))}
                </>
              )}
            </div>

            {/* Horizontal divider — settled streams below */}
            <div className="flex items-center gap-3 py-4">
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-dim/45">
                Committed &amp; closed
                <span className="font-mono">{settled.length}</span>
              </span>
              <div className="h-px flex-1 bg-white/8" />
            </div>

            <div className="relative space-y-0.5">
              {settled.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/8 px-4 py-5 text-center text-[11px] text-text-dim/40 italic">
                  Nothing committed or closed yet.
                </div>
              ) : (
                <>
                  <div className="absolute left-[6px] top-2 bottom-2 w-px bg-white/8" aria-hidden />
                  {settled.map((s) => <StreamCard key={s.id} stream={s} number={numberOf[s.id]} merged={mergedIds.has(s.id)} onOpen={() => { setViewId(s.id); dispatch({ type: 'SET_INSPECTOR', context: { type: 'stream', streamId: s.id } }); }} />)}
                </>
              )}
            </div>
          </>
        )}
        </>)}
      </div>

      {/* New stream modal */}
      {composing && (
        <Modal onClose={closeComposer} size="lg" maxHeight="85vh">
          <ModalHeader onClose={closeComposer}>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">New stream</h2>
              <span className="text-[10px] uppercase tracking-wider text-text-dim/40">Step {step} of 2 · {step === 1 ? 'Perspective pair' : 'Question & intuition'}</span>
            </div>
          </ModalHeader>
          <ModalBody className="p-6 space-y-4">
            {step === 1 ? (<>
            {/* Perspective pair — two collapse-on-select pickers stacked:
                WHO contributes (member/agent) → which perspective they DEVELOP.
                Each shows a searchable, tier-tagged list while choosing, then
                folds to a compact chosen-row; "Change" reopens it. */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Perspective pair</label>
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">

                {/* Contributor */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-text-dim/50">Contributor</span>
                    {!actorOpen && hasActor && (
                      <button onClick={() => setActorOpen(true)} className="ml-auto text-[10px] uppercase tracking-wider text-text-dim/50 hover:text-text-primary transition-colors">Change</button>
                    )}
                  </div>
                  {!actorOpen && hasActor ? (
                    <PickerChosenRow
                      label={actorName || (selectedAgent ? 'Agent' : 'Member')}
                      meta={selectedAgent ? `${agentPersonaLabel(selectedAgent)} · AI player` : 'Member'}
                      ai={!!selectedAgent}
                      onClick={() => setActorOpen(true)}
                    />
                  ) : (<>
                    <Segmented<'members' | 'agents'>
                      size="sm"
                      options={[
                        { value: 'members', label: 'Members' },
                        { value: 'agents', label: 'Agents' },
                      ]}
                      value={actorTab}
                      onChange={setActorTab}
                    />
                    <PickerSearch value={actorQuery} onChange={setActorQuery} placeholder={`Search ${actorTab}…`} />
                    <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto">
                      {actorTab === 'members' ? (
                        members.length === 0 ? (
                          <PickerEmpty>No members yet — add them from Config → Members.</PickerEmpty>
                        ) : (() => {
                          const q = actorQuery.trim().toLowerCase();
                          const list = q ? members.filter((p) => memberName(p).toLowerCase().includes(q)) : members;
                          if (list.length === 0) return <PickerEmpty>No members match “{actorQuery.trim()}”.</PickerEmpty>;
                          return list.map((p) => (
                            <PickerRow key={p.id} label={memberName(p)} meta="Member" selected={memberId === p.id} onClick={() => pickMember(p.id)} />
                          ));
                        })()
                      ) : (
                        agents.length === 0 ? (
                          <PickerEmpty>No agents yet — add AI players from Config → Agents.</PickerEmpty>
                        ) : (() => {
                          const q = actorQuery.trim().toLowerCase();
                          const list = q ? agents.filter((a) => (a.name || 'Agent').toLowerCase().includes(q)) : agents;
                          if (list.length === 0) return <PickerEmpty>No agents match “{actorQuery.trim()}”.</PickerEmpty>;
                          return list.map((a) => (
                            <PickerRow key={a.id} label={a.name || 'Agent'} meta={agentPersonaLabel(a)} ai selected={agentId === a.id} onClick={() => pickAgent(a.id)} />
                          ));
                        })()
                      )}
                    </div>
                  </>)}
                </div>

                <div className="h-px bg-white/6" />

                {/* Developing perspective */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-text-dim/50">Developing perspective</span>
                    {!vantageOpen && selectedVantage && (
                      <button onClick={() => setVantageOpen(true)} className="ml-auto text-[10px] uppercase tracking-wider text-text-dim/50 hover:text-text-primary transition-colors">Change</button>
                    )}
                  </div>
                  {!vantageOpen && selectedVantage ? (
                    <PickerChosenRow
                      imageUrl={selectedVantage.imageRef ? vantageImages.get(selectedVantage.imageRef) ?? null : null}
                      label={selectedVantage.label}
                      meta={selectedVantage.kind === 'narrator'
                        ? 'Narrator'
                        : `${TIER_LABEL[selectedVantage.tier ?? ''] ?? ''} · ${selectedVantage.kind[0].toUpperCase()}${selectedVantage.kind.slice(1)}`}
                      onClick={() => setVantageOpen(true)}
                    />
                  ) : (<>
                    <Segmented<VantageTab>
                      size="sm"
                      options={VANTAGE_TABS.map((t) => ({ value: t, label: `${t[0].toUpperCase()}${t.slice(1)}` }))}
                      value={vantageTab}
                      onChange={setVantageTab}
                    />
                    <PickerSearch value={vantageQuery} onChange={setVantageQuery} placeholder={`Search ${vantageTab}s…`} />
                    <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto">
                      {(() => {
                        const q = vantageQuery.trim().toLowerCase();
                        const filtered = (q ? vantagesByTab[vantageTab].filter((v) => v.label.toLowerCase().includes(q)) : vantagesByTab[vantageTab])
                          .slice()
                          .sort((a, b) => (TIER_RANK[a.tier ?? ''] ?? 9) - (TIER_RANK[b.tier ?? ''] ?? 9) || a.label.localeCompare(b.label));
                        if (vantagesByTab[vantageTab].length === 0) return <PickerEmpty>No {vantageTab}s.</PickerEmpty>;
                        if (filtered.length === 0) return <PickerEmpty>No {vantageTab}s match “{vantageQuery.trim()}”.</PickerEmpty>;
                        return filtered.map((v) => (
                          <PickerRow
                            key={v.key}
                            imageUrl={v.imageRef ? vantageImages.get(v.imageRef) ?? null : null}
                            label={v.label}
                            meta={TIER_LABEL[v.tier ?? ''] ?? v.tier}
                            selected={vantageKey === v.key}
                            onClick={() => pickVantage(v.key)}
                          />
                        ));
                      })()}
                    </div>
                  </>)}
                </div>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={() => setStep(2)}
                disabled={!vantageKey || !hasActor}
                className="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
              >
                Next - Question & Intuition
              </button>
            </div>
            </>) : (<>
            {/* Step 2 — open question + intuition. Each field has its own
                targeted suggester (no combo): suggest a question, then suggest
                an intuition on THAT question. */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 flex items-center gap-2">
              {selectedAgent ? (
                <div className="flex items-center gap-1">
                  <Avatar label={selectedAgent.name || 'Agent'} title={`${selectedAgent.name || 'Agent'} · ${agentPersonaLabel(selectedAgent)} · AI player`} size={22} ai />
                  <span className="text-text-dim/40 text-[11px]">→</span>
                </div>
              ) : (
                <PerspectivePairBadge memberId={memberId || undefined} perspectiveId={undefined} n={n} size={22} />
              )}
              <span className="text-[12px] text-text-secondary truncate">
                {selectedAgent ? `${selectedAgent.name || 'Agent'} · ` : ''}{selectedVantage?.label}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Open question</label>
                <button
                  onClick={handleSuggestQuestion}
                  disabled={suggestingQ}
                  className="ml-auto shrink-0 text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  title="Suggest an open question from this perspective's continuity"
                >
                  {suggestingQ ? 'Thinking...' : 'Suggest'}
                </button>
              </div>
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="An open question this stream will hold a stance on…"
                autoFocus
                rows={2}
                className="bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Initial intuition</label>
                <button
                  onClick={handleSuggestIntuition}
                  disabled={suggestingI || !title.trim()}
                  className="ml-auto shrink-0 text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  title={title.trim() ? 'Suggest an intuition for this question' : 'Enter or suggest a question first'}
                >
                  {suggestingI ? 'Thinking...' : 'Suggest'}
                </button>
              </div>
              <textarea
                value={intuition}
                onChange={(e) => setIntuition(e.target.value)}
                placeholder="Your gut read — this seeds the stance and becomes the first prior."
                rows={4}
                className="bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed"
              />
              <span className="text-[10px] text-text-dim/40">The AI opens the stream with outcomes + initial probabilities from this intuition.</span>
            </div>
            {openErr && (
              <div className="text-[11px] text-red-400/90 bg-red-500/10 border border-red-400/30 rounded-md px-2.5 py-1.5">{openErr}</div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => { setStep(1); setOpenErr(null); }}
                disabled={opening}
                className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 text-[12px]"
              >
                ← Back
              </button>
              <button
                onClick={submit}
                disabled={!intuition.trim() || opening}
                className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
              >
                {opening ? 'Opening…' : 'Create stream'}
              </button>
            </div>
            </>)}
          </ModalBody>
        </Modal>
      )}

      {/* Commit review — fullscreen, expansive per-stream review */}
      {committing && (
        <Modal onClose={() => setCommitting(false)} fullScreen>
          <div className="flex flex-col h-full">
            {/* Header bar */}
            <div className="shrink-0 flex items-center gap-3 px-6 h-14 border-b border-white/8">
              <IconMerge size={16} />
              <h2 className="text-sm font-semibold text-text-primary shrink-0">
                Commit {selectedOpen.length} {selectedOpen.length === 1 ? 'stream' : 'streams'}
              </h2>
              <input
                value={mergeLabel}
                onChange={(e) => setMergeLabel(e.target.value)}
                placeholder="Commit label…"
                className="max-w-xs bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent/40"
              />
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setCommitting(false)}
                  className="py-1.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition text-[12px]"
                >
                  Cancel
                </button>
                <button
                  onClick={doCommit}
                  className="py-1.5 px-4 rounded-lg bg-purple-600/80 hover:bg-purple-600 text-white font-semibold transition text-[12px]"
                >
                  Commit to history
                </button>
              </div>
            </div>
            {/* Body — one expansive review card per stream */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-4xl mx-auto p-6 space-y-5">
                <p className="text-[11px] text-text-dim/50">
                  Each <span className="text-emerald-300/80">executive</span> stream commits with a final outcome — the stance leader is the default; override where reality says otherwise, or select more than one to <span className="text-purple-300/80">multi-resolve</span>. Mark a stream <span className="text-text-secondary">record only</span> to fold it in for the record without an executive decision — it won&apos;t drive generation. Only executive decisions move the world.
                </p>
                {selectedOpen.map((s) => {
                  const draft = resolutionDraft[s.id] ?? [];
                  return (
                  <StreamReviewCard
                    key={s.id}
                    stream={s}
                    n={n}
                    chosen={draft}
                    // Empty committed set ⇒ record-only.
                    recordOnly={draft.length === 0}
                    onToggle={(o) =>
                      setResolutionDraft((d) => {
                        const cur = d[s.id] ?? [];
                        // Toggling MAY empty the set — that's how you make it
                        // record-only (uncheck every outcome).
                        const next = cur.includes(o)
                          ? cur.filter((x) => x !== o)
                          : [...cur, o];
                        return { ...d, [s.id]: next };
                      })
                    }
                    // Badge flips the whole state: clear → record-only, or
                    // restore the stance leader → executive.
                    onToggleRecordOnly={() =>
                      setResolutionDraft((d) => {
                        const cur = d[s.id] ?? [];
                        if (cur.length === 0) {
                          const outs = s.outcomes ?? [];
                          const { topIdx } = streamMargin(s);
                          const leader = outs[topIdx] ?? outs[0];
                          return { ...d, [s.id]: leader ? [leader] : [] };
                        }
                        return { ...d, [s.id]: [] };
                      })
                    }
                  />
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Picker primitives — the searchable list-row affordance shared by the
// new-stream Contributor + Developing-perspective pickers (mirrors the
// GeneratePanel cast/location pickers: search field, avatar+name+tier rows,
// collapse-to-chosen-row once a pick is made). ───────────────────────────────

/** Search input with a leading magnifier + clear button. */
function PickerSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-bg-field/60 border border-white/10 px-2.5 focus-within:border-accent/40">
      <IconSearch size={13} className="text-text-dim/45 shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent py-1.5 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-text-dim/40 hover:text-text-primary shrink-0" title="Clear">
          <IconClose size={12} />
        </button>
      )}
    </div>
  );
}

const PickerEmpty = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 py-3 text-center text-[11px] text-text-dim/40 italic">{children}</p>
);

/** One selectable row — avatar, name, right-aligned tier/meta tag, check when
 *  selected. */
function PickerRow({ imageUrl, label, meta, selected, ai, onClick }: {
  imageUrl?: string | null; label: string; meta?: string; selected?: boolean; ai?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${selected ? 'bg-accent/10' : 'hover:bg-white/5'}`}
    >
      <Avatar label={label} imageUrl={imageUrl} size={28} selected={selected} ai={ai} />
      <span className="flex-1 min-w-0 truncate text-[12.5px] text-text-primary">{label}</span>
      {meta && <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-dim/40">{meta}</span>}
      {selected && <IconCheck size={13} className="text-accent shrink-0" />}
    </button>
  );
}

/** Collapsed chosen-row — what a picker folds to after a pick; click to reopen. */
function PickerChosenRow({ imageUrl, label, meta, ai, onClick }: {
  imageUrl?: string | null; label: string; meta?: string; ai?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Change selection"
      className="flex items-center gap-2.5 rounded-lg border border-accent/25 bg-accent/6 px-2.5 py-2 text-left hover:bg-accent/10 transition-colors"
    >
      <Avatar label={label} imageUrl={imageUrl} size={30} ai={ai} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-text-primary truncate">{label}</div>
        {meta && <div className="text-[9.5px] uppercase tracking-wide text-text-dim/50 truncate">{meta}</div>}
      </div>
      <IconCheck size={14} className="text-accent shrink-0" />
    </button>
  );
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Score a new prior into thread-style evidence and apply it to the stance,
 *  returning the updated stream. Falls back to a plain prior for legacy streams
 *  that have no outcomes. */
async function scoreAndApply(stream: Stream, text: string, n: NarrativeState | null): Promise<Stream> {
  const outcomes = stream.outcomes ?? [];
  if (outcomes.length === 0) return applyStreamPrior(stream, { text, authorId: stream.memberId });
  const scored = await scoreStreamPrior({
    question: stream.title,
    outcomes,
    currentProbs: streamProbs(stream),
    priorText: text,
    perspectiveLabel: perspectiveName(n?.perspectives?.[stream.perspectiveId], n),
  });
  return applyStreamPrior(stream, {
    text,
    authorId: stream.memberId,
    updates: scored.updates,
    logType: scored.logType,
    volumeDelta: scored.volumeDelta,
    addOutcomes: scored.addOutcomes,
  });
}

// Outcome palette — keyed by position (consistent within a stream's bars/lists).
export const OUTCOME_HEX = ['#22d3ee', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#38bdf8', '#f472b6', '#a3e635'];

/** Probability-over-priors line chart for a stream — one polyline per outcome,
 *  the leading outcome emphasized. Thin adapter over the shared TrajectoryChart
 *  (consistent sizing + stroke with every other belief surface); `axes` adds
 *  the 0–100% gridlines + opened→now labels, else a bare card-preview chart. */
function TrajectoryChart({ stream, axes = false, className = 'h-7' }: { stream: Stream; axes?: boolean; className?: string }) {
  const traj = streamTrajectory(stream);
  const outcomes = stream.outcomes ?? [];
  if (traj.length === 0 || outcomes.length === 0) return null;
  const { topIdx } = streamMargin(stream);
  return (
    <TrajectoryChart_
      points={traj}
      outcomeCount={outcomes.length}
      colourOf={(k) => OUTCOME_HEX[k % OUTCOME_HEX.length]}
      highlightIdx={topIdx}
      axes={axes}
      xLeft={axes ? 'opened' : undefined}
      xRight={axes ? 'now' : undefined}
      className={`w-full ${className}`}
    />
  );
}

/** Compact belief spark for a stream — leading outcome + % over a small
 *  probability-over-priors chart. Shared by the Streams list cards and the
 *  Merge (History) rows so both lists display the trajectory identically. */
export function StreamBeliefSpark({ stream }: { stream: Stream }) {
  const probs = streamProbs(stream);
  const { topIdx } = streamMargin(stream);
  const outcomes = stream.outcomes ?? [];
  if (outcomes.length === 0 || topIdx < 0) return null;
  return (
    <div className="w-32 shrink-0 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[11px] min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: OUTCOME_HEX[topIdx % OUTCOME_HEX.length] }} />
        <span className="text-text-secondary truncate">{outcomes[topIdx]}</span>
        <span className="ml-auto font-mono text-text-primary tabular-nums">{Math.round((probs[topIdx] ?? 0) * 100)}%</span>
      </div>
      <TrajectoryChart stream={stream} className="h-7" />
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-[14px] font-mono tabular-nums text-text-secondary">{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-text-dim/40">{label}</span>
    </span>
  );
}

/** Full belief panel for the stream detail — category + metrics header, ranked
 *  outcomes on the left, probability-over-priors chart on the right. Shared with
 *  the merge detail (History) so a committed stream reads the same way. */
export function StreamBeliefPanel({ stream }: { stream: Stream }) {
  const outcomes = stream.outcomes ?? [];
  if (outcomes.length === 0) return null;
  const probs = streamProbs(stream);
  const { topIdx, margin } = streamMargin(stream);
  const uncertainty = normalizedEntropy(probs);
  const vol = stream.stance?.volume ?? 0;
  const volat = stream.stance?.volatility ?? 0;
  const category = classifyStreamCategory(stream);
  const ranked = outcomes.map((o, i) => ({ o, i, p: probs[i] ?? 0 })).sort((a, b) => b.p - a.p);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: THREAD_CATEGORY_HEX[category] }}>
          {THREAD_CATEGORY_LABEL[category]}
        </span>
        {stream.closedAt && stream.resolutionQuality !== undefined && (
          <span className="text-[10px] text-purple-300/80" title="Resolution quality">resolved · {Math.round(stream.resolutionQuality * 100)}%</span>
        )}
        <span className="ml-auto flex items-end gap-4">
          <Metric value={vol.toFixed(1)} label="volume" />
          <Metric value={`Δ${margin.toFixed(1)}`} label="margin" />
          <Metric value={`${Math.round(uncertainty * 100)}%`} label="uncertainty" />
          <Metric value={volat.toFixed(2)} label="volatility" />
        </span>
      </div>

      <div className="flex gap-5">
        {/* Ranked outcomes — labels wrap in full rather than truncating. */}
        <div className="flex flex-col gap-2.5 w-1/2 min-w-0">
          {ranked.map(({ o, i, p }) => (
            <div key={o} className="flex items-start gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.75" style={{ background: OUTCOME_HEX[i % OUTCOME_HEX.length] }} />
              <span className={`text-[13px] leading-snug wrap-break-word min-w-0 ${i === topIdx ? 'text-text-primary' : 'text-text-secondary'}`}>{o}</span>
              <span className="ml-auto shrink-0 font-mono text-[14px] font-semibold tabular-nums text-text-primary">{Math.round(p * 100)}%</span>
            </div>
          ))}
        </div>
        {/* Trajectory */}
        <div className="flex-1 min-w-0">
          <TrajectoryChart stream={stream} axes className="h-28" />
        </div>
      </div>
    </div>
  );
}

export const fmtStamp = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The full inner-world continuity of a stream's perspective entity — the
 *  traits/goals/secrets/relations that make its thinking character-true. */
function innerWorldText(perspectiveId: string | undefined, n: NarrativeState | null): string {
  const persp = perspectiveId ? n?.perspectives?.[perspectiveId] : undefined;
  const ent = perspectiveEntity(persp, n);
  if (!ent) return '';
  const nodes = Object.values(ent.world?.nodes ?? {}).map((nd) => `- ${nd.content}`);
  return [`${ent.name} — what is true of this ${persp?.kind}:`, ...nodes].join('\n');
}

/** One stream's review block in the fullscreen commit modal — full belief
 *  (outcomes + trajectory), the priors evolution, and toggleable outcome chips
 *  to assign the final outcome(s). The stance leader is the labelled default;
 *  toggling several chips commits a multi-resolution the generation reconciles. */
function StreamReviewCard({
  stream,
  chosen,
  onToggle,
  recordOnly,
  onToggleRecordOnly,
  n,
}: {
  stream: Stream;
  /** The committed outcome set so far (defaults to [leader] in the parent). */
  chosen: string[];
  onToggle: (outcome: string) => void;
  /** When true, this stream is folded in for the record only — no executive
   *  decision, so it won't drive generation. */
  recordOnly: boolean;
  onToggleRecordOnly: () => void;
  n: NarrativeState | null;
}) {
  const outcomes = stream.outcomes ?? [];
  const probs = streamProbs(stream);
  const { topIdx } = streamMargin(stream);
  const leading = outcomes[topIdx];
  const priors = [...stream.priors].sort((a, b) => a.at - b.at);
  const ranked = outcomes.map((o, i) => ({ o, i, p: probs[i] ?? 0 })).sort((a, b) => b.p - a.p);
  // Effective set — fall back to the leader when nothing is explicitly chosen.
  // The committed set as-is — EMPTY means record-only (no executive call), so
  // no fallback to the leader here.
  const chosenSet = chosen;
  const multi = chosenSet.length > 1;

  return (
    <div className={`rounded-xl border bg-white/[0.02] p-4 space-y-4 ${recordOnly ? 'border-white/8 opacity-80' : 'border-white/10'}`}>
      <div className="flex items-center gap-2">
        <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={n} size={22} />
        <span className="text-[15px] font-semibold text-text-primary truncate">{stream.title}</span>
        {/* Executive decision vs record-only. Record-only keeps the stream in
            the merge but leaves it unresolved (won't drive generation). */}
        <button
          onClick={onToggleRecordOnly}
          aria-pressed={recordOnly}
          title={recordOnly
            ? 'Recorded only — no executive decision; folded in for the record, won’t drive generation. Click to resolve it instead.'
            : 'Executive decision — drives the continuation. Click to fold in for the record only (leave unresolved).'}
          className={`ml-auto shrink-0 text-[10px] px-2 py-1 rounded-md border transition-colors ${
            recordOnly
              ? 'border-white/15 text-text-dim/70 hover:text-text-primary'
              : 'border-emerald-400/40 text-emerald-300/90 hover:bg-emerald-500/10'
          }`}
        >
          {recordOnly ? 'Record only' : 'Executive'}
        </button>
        <span className="shrink-0 text-[11px] text-text-dim/40">{priors.length} priors</span>
      </div>

      {/* Belief — distribution + how priors evolved (trajectory) */}
      <StreamBeliefPanel stream={stream} />

      {/* Final outcome(s) — toggleable chips. 1+ chosen = executive decision
          (the stance leader is the default; select several to multi-resolve).
          Uncheck them all to make it RECORD-ONLY — folded in for the record,
          tracking only the prior distribution, never driving generation. */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-wider text-text-dim/50 flex items-center gap-2">
          {recordOnly ? 'Outcome — none (recorded)' : 'Final outcome'}
          {multi && <span className="text-purple-300/80 normal-case tracking-normal">multi-resolution · {chosenSet.length} outcomes</span>}
        </label>
        <div className="flex flex-wrap gap-2">
          {ranked.map(({ o, i, p }) => {
            const isLeading = o === leading;
            const isChosen = chosenSet.includes(o);
            return (
              <button
                key={o}
                onClick={() => onToggle(o)}
                aria-pressed={isChosen}
                title={isChosen ? 'Committed — click to uncheck' : 'Click to commit this outcome (executive decision)'}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  isChosen
                    ? 'border-purple-400/60 bg-purple-500/15 text-text-primary'
                    : recordOnly && isLeading
                      ? 'border-emerald-400/50 bg-emerald-500/10 text-text-primary ring-1 ring-emerald-400/30 hover:bg-emerald-500/15'
                      : 'border-white/10 text-text-secondary hover:bg-white/5'
                }`}
              >
                <span className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${isChosen ? 'bg-purple-500/40 border-purple-400/70 text-purple-100' : 'border-white/25'}`}>
                  {isChosen && <IconCheck size={9} />}
                </span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OUTCOME_HEX[i % OUTCOME_HEX.length] }} />
                <span className="text-[13px]">{o}</span>
                <span className="font-mono text-[12px] tabular-nums text-text-dim/70">{Math.round(p * 100)}%</span>
                {isLeading && <span className="text-[9px] uppercase tracking-wide text-emerald-400/80">default</span>}
              </button>
            );
          })}
        </div>
        {recordOnly ? (
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-emerald-400/25 bg-emerald-500/[0.04] px-3 py-2 text-[11px] text-text-dim/65 leading-relaxed">
            <IconChevronDown size={13} className="shrink-0 mt-0.5 rotate-180 text-emerald-300/70" />
            <span>
              <span className="text-text-secondary">Recorded only</span> — no executive commitment; this stream just tracks the final prior distribution and <span className="text-text-secondary">won&apos;t drive generation</span>. <span className="text-emerald-300/90">Click an outcome above</span> to commit it as an executive decision.
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-text-dim/45 leading-relaxed">
            Uncheck every outcome to fold this in as <span className="text-text-dim/70">record only</span> (tracked, but not an executive decision).
          </p>
        )}
      </div>

      {/* Priors evolution */}
      {priors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-text-dim/50">Priors over time</label>
          <div className="rounded-lg border border-white/8 divide-y divide-white/6 max-h-48 overflow-y-auto">
            {priors.map((p) => (
              <div key={p.id} className="flex items-baseline gap-2 px-3 py-1.5">
                <span className="shrink-0 text-[10px] text-text-dim/40 tabular-nums">{fmtStamp(p.at)}</span>
                {p.logType && <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-dim/40">{p.logType}</span>}
                <span className="text-[12px] text-text-secondary leading-snug">{p.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Stream state → rail-dot colour (matches StreamStateIcon's octicon colours).
const STREAM_STATE_HEX: Record<Stream['state'], string> = {
  open: '#34d399',
  committed: '#a855f7',
  closed: '#f87171',
};

function StreamCard({
  stream,
  number,
  merged,
  selected = false,
  onToggleSelect,
  onOpen,
}: {
  stream: Stream;
  number: number;
  merged: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpen?: () => void;
}) {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;
  const isOpen = stream.state === 'open';
  const selectable = isOpen && !!onToggleSelect;
  const [quick, setQuick] = useState('');
  const [scoring, setScoring] = useState(false);

  const addQuickPrior = async () => {
    const t = quick.trim();
    if (!t || scoring) return;
    setScoring(true);
    try {
      const next = await scoreAndApply(stream, t, n);
      dispatch({ type: 'UPSERT_STREAM', stream: next });
      setQuick('');
    } finally {
      setScoring(false);
    }
  };

  // Open → close; closed → reopen. Delete on open/closed only — committed
  // streams are sealed in history and cannot be deleted.
  const menuItems = [
    ...(stream.state === 'open' ? [{ label: 'Close stream', onClick: () => dispatch({ type: 'CLOSE_STREAM' as const, streamId: stream.id }) }] : []),
    ...(stream.state === 'closed' ? [{ label: 'Reopen stream', onClick: () => dispatch({ type: 'REOPEN_STREAM' as const, streamId: stream.id }) }] : []),
    ...(stream.state !== 'committed' ? [{ label: 'Delete stream', danger: true, onClick: () => dispatch({ type: 'REMOVE_STREAM' as const, id: stream.id }) }] : []),
  ];

  const dotColor = STREAM_STATE_HEX[stream.state] ?? STREAM_STATE_HEX.open;
  return (
    <div className="group relative pl-6">
      {/* State dot on the lineage rail (open = emerald, committed = purple,
          closed = red) — the stream cousin of the branch-tree dot. */}
      <span
        className="absolute left-[2px] top-[15px] h-[9px] w-[9px] rounded-full border-[1.5px]"
        style={{ borderColor: dotColor, background: dotColor, opacity: stream.state === 'closed' ? 0.5 : 0.9 }}
        title={stream.state}
        aria-hidden
      />
      <div className={`relative overflow-hidden rounded-lg px-3 py-2 transition-colors flex items-center gap-3 ${selected ? 'bg-purple-500/10' : 'hover:bg-white/[0.035]'}`}>
        {/* Selected rows get a quiet purple left-edge accent (branch-style). */}
        {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-purple-400/70" aria-hidden />}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {selectable && (
            <button
              onClick={onToggleSelect}
              className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                selected ? 'bg-purple-500/30 border-purple-400/70 text-purple-100' : 'border-white/20 hover:border-white/40'
              }`}
              title={selected ? 'Deselect' : 'Select to commit & collapse'}
              aria-pressed={selected}
            >
              {selected && <IconCheck size={10} />}
            </button>
          )}
          <button
            onClick={onOpen}
            className="text-[13px] font-medium text-text-primary leading-snug truncate text-left group-hover:text-white hover:text-accent transition-colors"
            title="Open stream"
          >
            {stream.title}
          </button>
          <span className="shrink-0 text-[10px] text-text-dim/40">
            {stream.priors.length}p
            {stream.inferred && <> · <span className="text-amber-400/70 italic">inferred</span></>}
            {merged && <> · <span className="text-purple-400/80">merged</span></>}
          </span>
          <span className="shrink-0 text-[11px] text-text-dim/30 font-mono">#{number}</span>
        </div>

        <div className="flex items-center gap-2">
          <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={n} size={20} />
          {isOpen ? (
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <input
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addQuickPrior(); }}
                placeholder="Add a prior…"
                className="flex-1 min-w-0 bg-bg-field/60 border border-white/10 rounded-md px-2 py-0.5 text-[12px] text-text-primary outline-none focus:border-accent/40 placeholder:text-text-dim/40"
              />
              <button
                onClick={addQuickPrior}
                disabled={!quick.trim() || scoring}
                className="shrink-0 p-1 rounded-md text-text-dim/60 hover:text-text-primary hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                title="Add prior (AI scores it into the stance)"
              >
                <IconPlus size={13} className={scoring ? 'animate-pulse' : ''} />
              </button>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <KebabMenu items={menuItems} />
        </div>
      </div>

        {/* Belief — spark chart with the leading outcome + % on the far right */}
        <StreamBeliefSpark stream={stream} />
      </div>
    </div>
  );
}

// Compact actions menu — frees the card row for the quick-add input. The menu
// panel is portalled to <body> with fixed positioning anchored to the button:
// the card row is `overflow-hidden` (for its rounded corners + accent bar) and
// sits inside a scrolling list, so an in-flow absolute dropdown would be clipped
// to the row. The portal escapes both clipping contexts.
function KebabMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded-md text-text-dim/50 hover:text-text-primary hover:bg-white/5 transition-colors"
        title="More"
      >
        <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-9999 min-w-[140px] rounded-md border border-white/12 bg-bg-base shadow-xl shadow-black/50 py-1"
          style={{ top: pos.top, right: pos.right }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => { it.onClick(); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                it.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Stream detail — the priors timeline + composer, shown in-place in the tab.
function StreamDetail({ stream, number, onBack, onBranch }: { stream: Stream; number: number; onBack: () => void; onBranch: (seed: { question: string; intuition?: string; memberId?: string; agentId?: string; perspectiveId: string }) => void }) {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;
  const [draft, setDraft] = useState('');
  const [scoring, setScoring] = useState(false);
  const [suggestingPrior, setSuggestingPrior] = useState(false);
  const [branching, setBranching] = useState(false);
  // Whether the Guide popover is open. It collects an optional free-text
  // direction that steers the AI, then offers the choice to Add Branch or Add
  // Prior with that steer — mirroring the scene-plan "optional direction"
  // affordance. Blank steer = unguided.
  const [guide, setGuide] = useState(false);

  const isOpen = stream.state === 'open';
  const priors = [...stream.priors].sort((a, b) => a.at - b.at);

  const addPrior = async () => {
    const t = draft.trim();
    if (!t || scoring || !isOpen) return;
    setScoring(true);
    try {
      const next = await scoreAndApply(stream, t, n);
      dispatch({ type: 'UPSERT_STREAM', stream: next });
      setDraft('');
    } finally {
      setScoring(false);
    }
  };

  // Intelligent next prior — from this perspective's inner world, building on
  // the priors so far. Drops into the composer for the member to edit/add.
  const handleSuggestPrior = async (direction?: string) => {
    if (suggestingPrior || !isOpen || !n) return;
    setSuggestingPrior(true);
    try {
      const text = await suggestPrior({
        question: stream.title,
        outcomes: stream.outcomes ?? [],
        currentProbs: streamProbs(stream),
        priors: priors.map((p) => p.text),
        perspectiveLabel: perspectiveName(n?.perspectives?.[stream.perspectiveId], n),
        entityContext: innerWorldText(stream.perspectiveId, n),
        narrativeContext: outlineContext(n, state.resolvedEntryKeys, state.resolvedEntryKeys.length - 1),
        // An agent-driven stream continues its priors with that player's persona.
        personaContext: resolveAgentPersona(resolveAgentById(n, stream.agentId)) || undefined,
        direction,
      });
      if (text) setDraft(text);
    } finally {
      setSuggestingPrior(false);
    }
  };

  // Branch the thinking — priors leading to a new line of thought. The AI reads
  // this stream's priors and proposes a DISTINCT sibling question the same
  // perspective would now also track. That question pre-seeds the create-stream
  // composer (opened at step 2, perspective pair kept) so the user continues
  // with intuition suggestion and opens the branch as its own stream.
  const handleBranch = async (direction?: string) => {
    if (branching || !n) return;
    setBranching(true);
    try {
      const persp = n.perspectives?.[stream.perspectiveId];
      const label = perspectiveName(persp, n);
      const persona = resolveAgentPersona(resolveAgentById(n, stream.agentId)) || undefined;
      // Other open questions on this perspective — stay distinct from all of them.
      const existingQuestions = Object.values(n.streams ?? {})
        .filter((s) => s.perspectiveId === stream.perspectiveId && s.id !== stream.id && s.state === 'open' && s.title.trim())
        .map((s) => s.title.trim());
      const { question, intuition } = await suggestBranchStream({
        fromQuestion: stream.title,
        priors: priors.map((p) => p.text),
        existingQuestions: [stream.title.trim(), ...existingQuestions],
        perspectiveLabel: label,
        entityContext: innerWorldText(stream.perspectiveId, n),
        narrativeContext: outlineContext(n, state.resolvedEntryKeys, state.resolvedEntryKeys.length - 1),
        personaContext: persona,
        direction,
      });
      if (!question) return;
      onBranch({ question, intuition, memberId: stream.memberId, agentId: stream.agentId, perspectiveId: stream.perspectiveId });
    } finally {
      setBranching(false);
    }
  };

  const dateLabel =
    stream.state === 'open' ? `opened ${fmtDate(stream.createdAt)}` :
    stream.state === 'committed' ? `committed ${fmtDate(stream.updatedAt)}` :
    `closed ${fmtDate(stream.updatedAt)}`;

  return (
    <div>
      {/* Back + header */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] text-text-dim/70 hover:text-text-primary transition-colors mb-3"
      >
        <IconChevronLeft size={13} /> Streams
      </button>

      <div className="flex items-center gap-2">
        <StreamStateIcon state={stream.state} size={16} />
        <span className="text-[15px] font-semibold text-text-primary min-w-0">
          <InlineText
            value={stream.title}
            placeholder="Stream goal"
            onSave={(title) => dispatch({ type: 'UPSERT_STREAM', stream: { ...stream, title } })}
          />
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-text-dim/40 font-mono">#{number}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-dim/50">
        <PerspectivePairBadge memberId={stream.memberId} agentId={stream.agentId} perspectiveId={stream.perspectiveId} n={n} size={20} />
        <span>{dateLabel} · {priors.length} {priors.length === 1 ? 'prior' : 'priors'}</span>
      </div>

      {/* Belief — distribution, metrics, trajectory */}
      {stream.outcomes && stream.outcomes.length > 0 && (
        <div className="mt-4"><StreamBeliefPanel stream={stream} /></div>
      )}

      {/* Priors timeline */}
      <div className="mt-4">
        {priors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/8 px-4 py-6 text-center text-[11px] text-text-dim/40 italic">
            No priors yet. Add the first observation below.
          </div>
        ) : (
          <ol className="relative ml-1">
            <div className="absolute left-[4px] top-1.5 bottom-1.5 w-px bg-white/10" aria-hidden />
            {priors.map((p) => (
              <li key={p.id} className="group relative pl-5 pb-3 last:pb-0">
                <span className="absolute left-0 top-1.5 w-[9px] h-[9px] rounded-full bg-slate-400/60 border border-white/20" aria-hidden />
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-text-dim/40 tabular-nums shrink-0">{fmtDateTime(p.at)}</span>
                  <button
                    onClick={() => dispatch({ type: 'REMOVE_STREAM_PRIOR', streamId: stream.id, priorId: p.id })}
                    className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 text-text-dim/40 hover:text-red-400 transition-all"
                    title="Delete prior"
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
                <div className="text-[12px] text-text-secondary leading-relaxed">
                  <InlineText
                    value={p.text}
                    multiline
                    placeholder="(empty)"
                    onSave={(text) => dispatch({ type: 'EDIT_STREAM_PRIOR', streamId: stream.id, priorId: p.id, text })}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Composer — only open streams accept new priors. A committed/closed
          stream's stance is sealed (the GM has folded or resolved it). */}
      {isOpen ? (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addPrior(); }}
            placeholder="Add a prior — an observation, note, or update…"
            rows={3}
            className="bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-dim/40">⌘↵ to add · AI scores it into the stance</span>
            {/* Integrated combo — a single Guide button opens the popover that
                collects an optional direction, then offers Add Branch / Add
                Prior with that steer; Enter Prior commits the draft directly. */}
            <div className="ml-auto relative inline-flex items-stretch rounded-lg border border-white/10">
              <button
                onClick={() => setGuide(true)}
                disabled={branching || suggestingPrior}
                aria-haspopup="dialog"
                aria-expanded={guide}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-l-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${guide ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}
                title="Guide the AI — set an optional direction, then add a branch or a prior with it."
              >
                <IconSparkle size={11} />
                {branching ? 'Branching…' : suggestingPrior ? 'Thinking…' : 'Guide'}
              </button>
              <button
                onClick={addPrior}
                disabled={!draft.trim() || scoring}
                className="px-3.5 py-1.5 text-[12px] font-semibold bg-white/10 hover:bg-white/16 text-text-primary transition-colors disabled:opacity-30 disabled:hover:bg-white/10 border-l border-white/10 rounded-r-lg"
              >
                {scoring ? 'Scoring…' : 'Add'}
              </button>
              {guide && (
                <StreamGuidePopover
                  branching={branching}
                  suggesting={suggestingPrior}
                  canBranch={priors.length > 0}
                  onClose={() => setGuide(false)}
                  onBranch={(direction) => { setGuide(false); handleBranch(direction); }}
                  onSuggest={(direction) => { setGuide(false); handleSuggestPrior(direction); }}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/8 px-4 py-3 flex items-center justify-center gap-3 text-[11px] text-text-dim/40 italic">
          <span>{stream.state === 'committed' ? 'Committed — folded into a merge.' : 'Closed.'} No further priors.</span>
          {stream.state === 'closed' && (
            <button
              onClick={() => dispatch({ type: 'REOPEN_STREAM', streamId: stream.id })}
              className="not-italic text-[11px] px-2 py-1 rounded-md border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
            >
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Guide popover for the stream AI actions — collects an optional free-text
 *  direction that steers the AI, then offers the choice to Add Branch or Add
 *  Prior with that steer (mirroring the scene-plan generate affordance).
 *  Anchored above the combo button group. Blank steer = unguided. Closes on
 *  Escape, outside click, or either action. */
function StreamGuidePopover({
  branching, suggesting, canBranch, onBranch, onSuggest, onClose,
}: {
  /** AI branch in flight — disables both actions. */
  branching: boolean;
  /** AI prior-suggestion in flight — disables both actions. */
  suggesting: boolean;
  /** Branch needs ≥1 prior to grow from. */
  canBranch: boolean;
  onBranch: (direction?: string) => void;
  onSuggest: (direction?: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const busy = branching || suggesting;
  const dir = () => text.trim() || undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      className="absolute bottom-full right-0 mb-2 z-50 w-80 rounded-lg border border-white/12 bg-bg-base shadow-2xl shadow-black/60 p-3"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <IconSparkle size={12} className="text-accent/70" />
        <span className="text-[11px] font-semibold text-text-primary">Guide</span>
        <button onClick={onClose} className="ml-auto text-text-dim/40 hover:text-text-primary transition-colors" title="Close">
          <IconClose size={12} />
        </button>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) onSuggest(dir()); }}
        placeholder="Optional direction to steer the AI… e.g. “focus on the rival's next move”. Leave blank for unguided."
        rows={3}
        className="w-full bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed"
      />
      {/* Combo button — two equal-width segments joined into one full-width
          control. Left commits a branch, right drafts the next prior; both
          carry the steer typed above. */}
      <div className="mt-2 flex items-stretch w-full rounded-md border border-white/10 overflow-hidden">
        <button
          onClick={() => onBranch(dir())}
          disabled={busy || !canBranch}
          title={canBranch ? 'Open a new branching stream steered by this direction' : 'Add a prior first — a branch grows from the priors so far'}
          className="flex-1 inline-flex items-center justify-center px-2.5 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {branching ? 'Branching…' : 'New Branch'}
        </button>
        <button
          onClick={() => onSuggest(dir())}
          disabled={busy}
          title="Draft the next prior steered by this direction"
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold bg-white/10 hover:bg-white/16 text-text-primary transition-colors disabled:opacity-40 border-l border-white/10"
        >
          {suggesting ? 'Thinking…' : 'New Prior'}
        </button>
      </div>
    </div>
  );
}
