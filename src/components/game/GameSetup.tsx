/** Conviction SETUP (plan §5a, §8). The GM seats players around the same poker
 *  table the game is played on — any entity with agency can take a seat:
 *  characters, but also load-bearing locations and artifacts. Clicking a roster
 *  row sits or unseats it; the selected seat's driver (agent / member / GM) is
 *  tuned in the centre dealer pedestal. Setup runs in two steps — the board
 *  (seat players), then the rules (economy + phase clocks). Perspectives are
 *  created on the fly for any seated entity that lacks one.
 *
 *  The roster sidebar searches and groups by kind, sorts by prominence tag
 *  (anchor/domain/key first), labels each row with its tag, and can ask the AI to
 *  suggest the active cast from the recent story. The felt, rail and seat pods
 *  mirror the live PokerTable so setup and play are one continuous metaphor. */
"use client";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/stage/RoomUI";
import { Modal, ModalHeader } from "@/components/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { IconSearch, IconClose, IconLightbulb, IconChevronDown } from "@/components/icons";
import type { StartGameConfig } from "@/hooks/useConviction";
import { BUILTIN_AGENTS } from "@/lib/agents/personas";
import { defaultEconomy } from "@/lib/game/economy";
import { suggestTableCast } from "@/lib/ai/game-cast";
import { SCENARIO_COLORS } from "@/lib/ai/variables";
import { KIND_TABS, buildSeatableRoster, type SeatKind, type SeatableEntity } from "@/lib/game/roster";
import { uid } from "@/components/stage/RoomUI";
import { useStore } from "@/lib/state/store";
import type {
  AgentPersonaKey,
  ConvictionEconomy,
  NarrativeState,
  Perspective,
  PerspectiveKind,
  ResolveBias,
  RoundPhase,
} from "@/types/narrative";

type Driver = "agent" | "human" | "gm-proxy";

interface SeatDraft {
  kind: SeatKind;
  entityId: string;
  driver: Driver;
  persona: AgentPersonaKey;
  memberId?: string;
}

const SECTION = "text-[10px] uppercase tracking-[0.15em] text-text-dim";
const CARD = "rounded-lg border border-white/10 bg-white/2";

const DRIVER_LABEL: Record<Driver, string> = { agent: "Agent", human: "Member", "gm-proxy": "GM" };

/** Per-phase clocks (CONCEPT §Constants — TIMER_*), with their shipped defaults
 *  in seconds. 0 = untimed. Presentation phases run short; the deliberative
 *  phases (READ / PLAY) get the time. Cosmetic while the game runs in computer
 *  mode; the difficulty lever for the human-vs-AI tempo dynamic when live. */
// Play has its OWN two clocks (per-move sequential / shared window simultaneous)
// set on the Play section from the economy — so it's not listed here.
const TIMED_PHASES: { phase: RoundPhase; label: string; hint: string; def: number }[] = [
  { phase: "read", label: "Read", hint: "Read the perspective that opened the scene", def: 45 },
  { phase: "write", label: "Write", hint: "Work the model — open streams, add priors (the strategic heart)", def: 240 },
  { phase: "showdown", label: "Showdown", hint: "Reveal all cards, settle conflicts together", def: 25 },
  { phase: "scoring", label: "Scoring", hint: "Impact readout", def: 20 },
];

const DEFAULT_PHASE_SECONDS: Partial<Record<RoundPhase, number>> = Object.fromEntries(
  TIMED_PHASES.map((t) => [t.phase, t.def]),
);

export function GameSetup({ onStart, onClose }: { onStart: (cfg: StartGameConfig) => void; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative as NarrativeState | null;
  const branchId = state.viewState.activeBranchId;

  const members = useMemo(() => Object.values(narrative?.members ?? {}), [narrative]);
  const defaultLocationId = useMemo(() => Object.keys(narrative?.locations ?? {})[0] ?? "", [narrative]);

  // Normalised, prominence-sorted roster per kind + flat lookup/colour maps.
  const { byKind, entityMap, colorIndex } = useMemo(() => buildSeatableRoster(narrative), [narrative]);

  const [step, setStep] = useState<"board" | "rules">("board");
  const [seats, setSeats] = useState<Record<string, SeatDraft>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindTab, setKindTab] = useState<SeatKind>("character");
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [econ, setEcon] = useState<ConvictionEconomy>(() => defaultEconomy());
  const [phaseSeconds, setPhaseSeconds] = useState<Partial<Record<RoundPhase, number>>>(
    () => ({ ...DEFAULT_PHASE_SECONDS }),
  );
  const [autoResolve, setAutoResolve] = useState(false);
  // Carry-over is decided at game creation via a confirm modal (only when a
  // prior game exists on this branch) — not an inline rules toggle.
  const [confirmCarryOpen, setConfirmCarryOpen] = useState(false);

  // A prior game on this branch whose balances could be carried over.
  const priorGame = useMemo(
    () =>
      Object.values(narrative?.gameRooms ?? {})
        .filter((r) => r.branchId === branchId)
        .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))[0],
    [narrative, branchId],
  );

  if (!narrative || !branchId) return <div className="p-6 text-text-dim">No active narrative.</div>;

  const seatList = Object.values(seats);
  const totalEntities = entityMap.size;
  const nameOf = (id: string) => entityMap.get(id)?.name ?? "—";
  const colorFor = (id: string) => SCENARIO_COLORS[(colorIndex[id] ?? 0) % SCENARIO_COLORS.length];

  const seat = (kind: SeatKind, id: string) =>
    setSeats((prev) => {
      if (prev[id]) return prev;
      setSelectedId(id);
      return { ...prev, [id]: { kind, entityId: id, driver: "agent", persona: "strategist", memberId: members[0]?.id } };
    });

  const unseat = (id: string) =>
    setSeats((prev) => {
      if (!prev[id]) return prev;
      const rest = { ...prev };
      delete rest[id];
      setSelectedId((cur) => (cur === id ? null : cur));
      return rest;
    });

  const toggleSeat = (kind: SeatKind, id: string) => (seats[id] ? unseat(id) : seat(kind, id));

  const update = (id: string, patch: Partial<SeatDraft>) =>
    setSeats((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const runSuggest = async () => {
    setSuggesting(true);
    setSuggestErr(null);
    try {
      const branch = narrative.branches?.[branchId];
      const recent = (branch?.entryIds ?? [])
        .filter((id) => narrative.scenes[id])
        .slice(-8)
        .map((id) => narrative.scenes[id]);
      const synopsis = recent
        .map((s, i) => (s.summary ? `${i + 1}. ${s.summary}` : ""))
        .filter(Boolean)
        .join("\n");
      const active = new Set<string>();
      recent.forEach((s) => {
        if (s.povId) active.add(s.povId);
        s.participantIds?.forEach((p) => active.add(p));
        if (s.locationId) active.add(s.locationId);
      });
      const line = (e: SeatableEntity) => `- [${e.id}] ${e.name} (${e.tag})${active.has(e.id) ? " ★" : ""}`;
      const roster = [
        "CHARACTERS:",
        ...byKind.character.map(line),
        "\nLOCATIONS:",
        ...byKind.location.map(line),
        "\nARTIFACTS:",
        ...byKind.artifact.map(line),
      ].join("\n");

      const picks = await suggestTableCast({ roster, recentSynopsis: synopsis || undefined });
      const valid = picks.filter((p) => entityMap.get(p.id)?.kind === p.kind);
      if (valid.length === 0) {
        setSuggestErr("No usable suggestions — seat players by hand.");
        return;
      }
      setSeats((prev) => {
        const next = { ...prev };
        for (const p of valid) if (!next[p.id]) next[p.id] = { kind: p.kind, entityId: p.id, driver: "agent", persona: "strategist", memberId: members[0]?.id };
        return next;
      });
    } catch (e) {
      setSuggestErr(e instanceof Error ? e.message : "Suggestion failed.");
    } finally {
      setSuggesting(false);
    }
  };

  const start = (persistEconomy: boolean) => {
    const seatConfigs = seatList.map((d) => {
      let persp = Object.values(narrative.perspectives ?? {}).find(
        (p: Perspective) => p.kind === (d.kind as PerspectiveKind) && p.entityRef === d.entityId,
      );
      const chosenAgent =
        d.driver === "agent"
          ? BUILTIN_AGENTS.find((a) => a.persona === d.persona)?.id ?? BUILTIN_AGENTS[0].id
          : undefined;
      const memberId = d.driver === "human" ? d.memberId ?? members[0]?.id : undefined;
      if (!persp) {
        persp = {
          id: uid("persp"),
          kind: d.kind,
          entityRef: d.entityId,
          ...(d.driver === "human" && memberId ? { memberIds: [memberId] } : {}),
          ...(d.driver === "agent" ? { agentId: chosenAgent } : {}),
        };
        dispatch({ type: "UPSERT_PERSPECTIVE", perspective: persp });
      }
      return {
        perspectiveId: persp.id,
        driver: d.driver,
        memberId,
        agentId: d.driver === "agent" ? chosenAgent : undefined,
        locationId: defaultLocationId,
      };
    });
    const timers = Object.fromEntries(Object.entries(phaseSeconds).filter(([, s]) => (s ?? 0) > 0));
    onStart({
      branchId,
      locations: defaultLocationId ? [defaultLocationId] : [],
      seats: seatConfigs,
      economy: econ,
      ...(Object.keys(timers).length ? { phaseSeconds: timers } : {}),
      ...(persistEconomy ? { persistEconomy: true } : {}),
      ...(autoResolve ? { autoResolve: true } : {}),
    });
  };

  const humanWithoutMember = seatList.some((d) => d.driver === "human" && members.length === 0);
  // A lone seat is a valid game — solo Conviction rehearses one perspective's
  // calls against the canon with no contests (the engine skips conflict reads
  // below two committed cards). Min 1.
  const canStart = seatList.length >= 1 && !humanWithoutMember;

  const selected = selectedId ? seats[selectedId] : null;

  const q = query.trim().toLowerCase();
  const roster = byKind[kindTab];
  const filtered = q ? roster.filter((e) => e.name.toLowerCase().includes(q)) : roster;

  return (
    <div className="flex h-full">
      {/* Sidebar — searchable, prominence-sorted player roster (board step only) */}
      {step === "board" && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-bg-base/40">
          <div className="flex flex-col gap-2.5 px-3.5 pb-3 pt-5">
            <div className="flex items-center gap-2">
              <span className={SECTION}>Players</span>
              <span className="text-[10px] tabular-nums text-text-dim/50">· {seatList.length} seated</span>
              <button
                onClick={runSuggest}
                disabled={suggesting || totalEntities === 0}
                title="Suggest the active cast from the recent story"
                className="ml-auto flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-[10px] font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-40"
              >
                <IconLightbulb size={11} className={suggesting ? "animate-pulse" : ""} />
                {suggesting ? "Thinking…" : "Suggest"}
              </button>
            </div>
            <SearchInput value={query} onChange={setQuery} placeholder={`Search ${kindTab}s…`} />
            <Segmented<SeatKind>
              size="sm"
              value={kindTab}
              onChange={setKindTab}
              options={KIND_TABS.map((t) => ({ value: t.kind, label: t.label }))}
            />
            {suggestErr && <p className="text-[10px] leading-relaxed text-amber-400/80">{suggestErr}</p>}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {totalEntities === 0 ? (
              <p className="px-2 py-3 text-[11px] text-text-dim/60">No entities in this world.</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-text-dim/50">
                {q ? `No matches for “${query}”.` : `No ${kindTab}s in this world.`}
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filtered.map((e) => {
                  const seated = seats[e.id];
                  const isSelected = selectedId === e.id;
                  return (
                    <div
                      key={e.id}
                      className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${
                        isSelected ? "bg-accent/12 ring-1 ring-accent/40" : "hover:bg-white/5"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => (seated ? setSelectedId(e.id) : seat(e.kind, e.id))}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <div className="rounded-full" style={seated ? { boxShadow: `0 0 0 2px ${colorFor(e.id)}` } : undefined}>
                          <Avatar label={e.name} size={28} dim={!seated} />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={`truncate text-[12.5px] ${seated ? "text-text-primary" : "text-text-secondary"}`}>
                              {e.name}
                            </span>
                            <TagPill tag={e.tag} />
                          </span>
                          {seated && (
                            <span className="block text-[9px] uppercase tracking-wider text-accent/80">
                              {DRIVER_LABEL[seated.driver]}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSeat(e.kind, e.id)}
                        title={seated ? `Remove ${e.name}` : `Seat ${e.name}`}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-none transition ${
                          seated
                            ? "text-text-dim/50 hover:bg-rose-500/20 hover:text-rose-300"
                            : "bg-violet-500/90 text-white hover:bg-violet-400"
                        }`}
                      >
                        {seated ? "×" : "+"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Main column — step header, then board or rules */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header + step indicator */}
        <header className="flex shrink-0 items-start justify-between gap-4 px-8 pt-6">
          <div className="flex flex-col gap-1">
            <h2 className="bg-linear-to-r from-violet-300 via-fuchsia-200 to-rose-300 bg-clip-text text-lg font-semibold text-transparent">
              New Conviction game
            </h2>
            <p className="text-[12px] text-text-dim">
              {step === "board"
                ? "Seat the table from the roster — the only score is Fate moved."
                : "Tune the rules, then start the game."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-1">
            <nav className="flex items-center gap-1.5">
              {(["board", "rules"] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => (s === "board" ? setStep("board") : canStart && setStep("rules"))}
                    disabled={s === "rules" && !canStart}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      step === s
                        ? "bg-violet-500/20 text-violet-200"
                        : "text-text-dim hover:text-text-secondary disabled:opacity-40 disabled:hover:text-text-dim"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                        step === s ? "bg-violet-400 text-black" : "bg-white/10 text-text-dim"
                      }`}
                    >
                      {i + 1}
                    </span>
                    {s === "board" ? "Table" : "Rules"}
                  </button>
                  {i === 0 && <span className="h-px w-3 bg-white/15" />}
                </div>
              ))}
            </nav>
            {/* Close — the only way out of setup (the live game exits via the GM). */}
            <button
              onClick={onClose}
              title="Close Conviction"
              aria-label="Close Conviction"
              className="rounded p-1.5 text-text-dim transition-colors hover:bg-white/5 hover:text-text-primary"
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        {step === "board" ? (
          <>
            {/* The table — the same felt the game is played on */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 min-h-0">
              {totalEntities === 0 ? (
                <div className="text-[12px] text-text-dim/60">No entities to seat in this world.</div>
              ) : (
                <div className="relative aspect-[1.7] w-full max-w-3xl">
                  {/* Rail */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "radial-gradient(ellipse at center, #161c2b 0%, #0a0e18 100%)",
                      boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)",
                    }}
                  />
                  {/* Felt */}
                  <div
                    className="absolute rounded-full"
                    style={{
                      inset: "14px",
                      background:
                        "radial-gradient(ellipse at 50% 42%, color-mix(in oklab, var(--color-accent) 14%, #0c1322) 0%, #070b13 72%)",
                      boxShadow: "inset 0 0 90px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.04)",
                    }}
                  />
                  <div className="absolute rounded-full border border-white/5" style={{ inset: "12%" }} />

                  {/* Centre dealer pedestal — seat count, or the selected seat's driver config */}
                  <div className="absolute left-1/2 top-1/2 flex w-[min(58%,26rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center">
                    {selected ? (
                      <>
                        <span className="text-[10px] uppercase tracking-[0.22em] text-text-dim/70">Driving this seat</span>
                        <span className="text-[14px] font-semibold text-text-primary">{nameOf(selected.entityId)}</span>
                        <Segmented<Driver>
                          size="sm"
                          value={selected.driver}
                          onChange={(v) => update(selected.entityId, { driver: v })}
                          options={[
                            { value: "agent", label: "Agent" },
                            { value: "human", label: "Member" },
                            { value: "gm-proxy", label: "GM" },
                          ]}
                        />
                        {selected.driver === "agent" && (
                          <select
                            value={selected.persona}
                            onChange={(e) => update(selected.entityId, { persona: e.target.value as AgentPersonaKey })}
                            className="rounded-md border border-white/10 bg-bg-field/60 px-2 py-1 text-[11px] text-text-primary outline-none focus:border-violet-400/40"
                          >
                            {BUILTIN_AGENTS.map((a) => (
                              <option key={a.id} value={a.persona}>
                                {a.persona}
                              </option>
                            ))}
                          </select>
                        )}
                        {selected.driver === "human" && (
                          <select
                            value={selected.memberId ?? ""}
                            onChange={(e) => update(selected.entityId, { memberId: e.target.value })}
                            className="rounded-md border border-white/10 bg-bg-field/60 px-2 py-1 text-[11px] text-text-primary outline-none focus:border-violet-400/40"
                          >
                            {members.length === 0 && <option value="">No members — add one in Members</option>}
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.firstName} {m.lastName}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => unseat(selected.entityId)}
                          className="text-[10px] uppercase tracking-wider text-rose-300/70 hover:text-rose-300"
                        >
                          Remove from table
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] uppercase tracking-[0.22em] text-text-dim/70">Seat the table</span>
                        <span className="font-mono text-3xl tabular-nums text-text-primary">{seatList.length}</span>
                        <span className="text-[11px] text-text-dim">
                          {seatList.length === 1 ? "1 seated" : `${seatList.length} seated`} · min 1
                        </span>
                        <span className="max-w-56 text-[10px] leading-relaxed text-text-dim/50">
                          {seatList.length === 0
                            ? "The table is empty. Add players from the sidebar, or hit Suggest."
                            : "Add more from the sidebar, or click a seated player to drive it."}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Seat pods around the rim — only seated players populate the board */}
                  {seatList.map((d, i) => {
                    const ent = entityMap.get(d.entityId);
                    if (!ent) return null;
                    const angle = (i / seatList.length) * 2 * Math.PI;
                    const x = 50 + 47 * Math.sin(angle);
                    const y = 50 - 45 * Math.cos(angle);
                    const isSelected = selectedId === d.entityId;
                    const color = colorFor(d.entityId);
                    return (
                      <div
                        key={d.entityId}
                        className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                        style={{ left: `${x}%`, top: `${y}%` }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(d.entityId)}
                          className="group flex w-28 flex-col items-center gap-1.5 transition"
                        >
                          <div
                            className={`rounded-full transition ${isSelected ? "ring-2 ring-accent ring-offset-2 ring-offset-transparent" : ""}`}
                            style={isSelected ? undefined : { boxShadow: `0 0 0 2px ${color}, 0 0 14px -2px ${color}` }}
                          >
                            <Avatar label={ent.name} size={42} />
                          </div>
                          <span className={`max-w-26 truncate text-[11px] font-medium transition ${isSelected ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"}`}>
                            {ent.name}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-text-dim/70">
                            {ent.tag} · <span className="text-accent/90">{DRIVER_LABEL[d.driver]}</span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer — seat summary + advance to rules */}
            <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-bg-base/40 px-8 py-4 backdrop-blur-md">
              <span className="text-[11px] text-text-dim">
                {seatList.length} seat{seatList.length === 1 ? "" : "s"}
                {!canStart && seatList.length < 1 && <span className="ml-2 text-amber-400/80">— seat at least 1</span>}
                {humanWithoutMember && <span className="ml-2 text-amber-400/80">— add a member or change driver</span>}
              </span>
              <button
                onClick={() => setStep("rules")}
                disabled={!canStart}
                className="rounded-full bg-violet-500 px-5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next: rules ▸
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Rules — economy, resolution, phase clocks as a settings rack */}
            <div className="flex-1 overflow-y-auto px-8 py-6 min-h-0">
              <div className="mx-auto flex max-w-2xl flex-col gap-5">
                {/* Play — the core game shape: how seats act in the play phase. */}
                <RuleSection
                  title="Play"
                  desc="How seats act in the play phase — the most pivotal lever on the game's feel."
                >
                  <SegRow label="Play mode">
                    <Segmented<"sequential" | "simultaneous">
                      size="sm"
                      value={econ.playOrder === "simultaneous" ? "simultaneous" : "sequential"}
                      onChange={(v) => setEcon({ ...econ, playOrder: v })}
                      options={[
                        { value: "sequential", label: "Sequential" },
                        { value: "simultaneous", label: "Simultaneous" },
                      ]}
                    />
                  </SegRow>
                  <div className="flex flex-col gap-1.5 rounded-md bg-white/2 px-2.5 py-2 text-[10px] leading-relaxed text-text-dim/60">
                    <ul className="flex flex-col gap-0.5 pl-0.5">
                      <li><span className="text-text-secondary">Sequential</span> — seats commit one at a time in deal order, poker-style; later seats read the table before they act. Each gets their own per-move clock.</li>
                      <li><span className="text-text-secondary">Simultaneous</span> — every seat commits at once, blind to the others, within one shared (more generous) window.</li>
                    </ul>
                  </div>
                  {/* Only the ACTIVE mode's clock applies, so only it is shown:
                      sequential resets a per-move budget each turn; simultaneous is
                      one shared window. Switching mode swaps the control. */}
                  <div className="pt-1">
                    {econ.playOrder === "simultaneous" ? (
                      <TimerTile
                        label="Window clock"
                        hint="One shared window all seats act within at once"
                        value={econ.windowSeconds ?? 0}
                        onChange={(v) => setEcon({ ...econ, windowSeconds: v })}
                      />
                    ) : (
                      <TimerTile
                        label="Per-move clock"
                        hint="Each player's budget on their own turn (the clock resets per turn)"
                        value={econ.turnSeconds ?? 0}
                        onChange={(v) => setEcon({ ...econ, turnSeconds: v })}
                      />
                    )}
                  </div>
                </RuleSection>

                {/* Resolution rules */}
                <RuleSection
                  title="Resolution"
                  desc="How contested threads settle when seats bet against each other."
                >
                  <SegRow label="Contested settlement">
                    <Segmented<ResolveBias>
                      size="sm"
                      value={econ.resolveBias}
                      onChange={(v) => setEcon({ ...econ, resolveBias: v })}
                      options={[
                        { value: "random", label: "Draw" },
                        { value: "highest-cost", label: "Rarest" },
                        { value: "realism", label: "Realism" },
                      ]}
                    />
                  </SegRow>
                  <div className="flex flex-col gap-1.5 rounded-md bg-white/2 px-2.5 py-2 text-[10px] leading-relaxed text-text-dim/60">
                    <span>
                      When seats bet on conflicting outcomes of the same thread, the contest settles by:
                    </span>
                    <ul className="flex flex-col gap-0.5 pl-0.5">
                      <li><span className="text-text-secondary">Draw</span> — a random pull from the conviction-shaped odds; the stake buys odds, never a guarantee.</li>
                      <li><span className="text-text-secondary">Rarest</span> — the highest-cost (longest-shot) outcome wins; rewards bold calls.</li>
                      <li><span className="text-text-secondary">Realism</span> — an impartial AI judge resolves the future by what would realistically occur, weighing conviction as intensity of intent.</li>
                      <li className="text-text-dim/50">However the winner is chosen, a realism pass interprets what reality resolved to — and you can veto / edit every resolution before commit.</li>
                    </ul>
                  </div>
                </RuleSection>

                {/* Approval — who advances the round. GM gates every phase by hand
                    (and reviews the continuation in the Generate Panel); Automatic
                    runs the whole loop on the phase clocks, including arc generation. */}
                <RuleSection
                  title="Approval"
                  desc="Who advances the round — you, phase by phase, or the clocks, hands-free."
                >
                  <SegRow label="Mode">
                    <Segmented<"review" | "auto">
                      size="sm"
                      value={autoResolve ? "auto" : "review"}
                      onChange={(v) => setAutoResolve(v === "auto")}
                      options={[
                        { value: "review", label: "GM" },
                        { value: "auto", label: "Automatic" },
                      ]}
                    />
                  </SegRow>
                  <p className="rounded-md bg-white/2 px-2.5 py-2 text-[10px] leading-relaxed text-text-dim/60">
                    <span className="text-text-secondary">GM</span> — you advance each phase, and the merge of the
                    players&rsquo; resolutions opens in the Generate Panel for you to review and run.{" "}
                    <span className="text-text-secondary">Automatic</span> — every phase advances on its own clock
                    and the arc generates with no panel, so the table runs end-to-end. You can still pause or end
                    early at any time.
                  </p>
                </RuleSection>

                {/* Advanced — phase clocks, economy carry-over, conviction economy
                    (sensible defaults; tucked away from the pivotal decisions). */}
                <div className="flex flex-col gap-3">
                  <button onClick={() => setAdvancedOpen((v) => !v)} className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-white/8" />
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-text-dim hover:text-text-primary">
                      Advanced · clocks &amp; conviction economy
                      <IconChevronDown size={11} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                    </span>
                    <div className="h-px flex-1 bg-white/8" />
                  </button>
                  {advancedOpen && (
                    <div className="flex flex-col gap-5">
                      {/* Phase clocks */}
                      <RuleSection
                        title="Phase clocks"
                        desc="Pace a live table; cosmetic while the game runs in computer mode."
                        aside="0 = off"
                      >
                        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                          {TIMED_PHASES.map((t) => (
                            <TimerTile
                              key={t.phase}
                              label={t.label}
                              hint={t.hint}
                              value={phaseSeconds[t.phase] ?? 0}
                              onChange={(v) => setPhaseSeconds((prev) => ({ ...prev, [t.phase]: v }))}
                            />
                          ))}
                        </div>
                        <p className="rounded-md bg-white/2 px-2.5 py-2 text-[10px] leading-relaxed text-text-dim/60">
                          Clocks are the tempo lever for the human-vs-AI dynamic — tighten them to raise the
                          pressure, loosen for teaching rooms. Read &amp; plan is the strategic heart; set any
                          phase to <span className="text-text-secondary">Off</span> to leave it untimed.
                        </p>
                      </RuleSection>

                      {/* Conviction economy — the scarcity dials */}
                      <RuleSection
                        title="Conviction economy"
                        desc="The scarcity lever — what each seat banks, and how rarity prices a play. Defaults are tuned; touch only to change the game's feel."
                      >
                        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                          <EconTile label="Starting conviction" hint="Opening balance every seat brings to the table." value={econ.start} min={10} max={150} step={5} onChange={(v) => setEcon({ ...econ, start: v })} />
                          <EconTile label="Income / round" hint="Fresh allowance granted each round at settle." value={econ.income} min={5} max={60} step={5} onChange={(v) => setEcon({ ...econ, income: v })} />
                          <CapSliderTile label="Decay / round" hint="Tax on banked conviction before income — idle capital erodes, so timing the save is the skill. No cap = no decay, conviction accumulates without limit." value={econ.decayAlpha} min={0} max={0.95} step={0.01} format={(v) => v.toFixed(2)} uncapped={!!econ.accumulationUncapped} onChange={(v) => setEcon({ ...econ, decayAlpha: v })} onUncap={(on) => setEcon({ ...econ, accumulationUncapped: on })} />
                          <EconTile label="Cards / round" hint="Most commits a seat may make per round — caps flooding the merge with cheap cards." value={econ.cardsPerRound} min={1} max={6} step={1} onChange={(v) => setEcon({ ...econ, cardsPerRound: v })} />
                          <EconTile label="Card-cost floor" hint="A play is never free; the floor makes agenda-setting cost something." value={econ.costMin} min={1} max={20} step={1} onChange={(v) => setEcon({ ...econ, costMin: v })} />
                          <CapSliderTile label="Card-cost ceiling" hint="The dearest a single play can price, however rare. No cap = the rarity curve runs unclamped." value={econ.costMax} min={100} max={300} step={10} uncapped={!!econ.costUncapped} onChange={(v) => setEcon({ ...econ, costMax: v })} onUncap={(on) => setEcon({ ...econ, costUncapped: on })} />
                          <EconTile label="Rarity → cost scale" hint="How steeply improbability raises a play's price (cost ≈ scale × −ln p)." value={econ.rarityScale} min={10} max={60} step={1} onChange={(v) => setEcon({ ...econ, rarityScale: v })} />
                          <EconTile label="Evidence gain" hint="How hard committed conviction moves the stance — concave, so doubling the stake doesn't double the shift." value={econ.evidenceGain} min={1} max={8} step={0.5} format={(v) => v.toFixed(1)} onChange={(v) => setEcon({ ...econ, evidenceGain: v })} />
                          <EconTile label="Face-down premium" hint="Cost multiplier to play a card concealed — buys secrecy, forfeited if a contest forces it open." value={econ.facedownPremium} min={1} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => setEcon({ ...econ, facedownPremium: v })} />
                        </div>
                        <p className="rounded-md bg-white/2 px-2.5 py-2 text-[10px] leading-relaxed text-text-dim/60">
                          {econ.accumulationUncapped ? (
                            <>Accumulation is <span className="text-text-secondary">uncapped</span> — conviction carries in full, no hoard ceiling.</>
                          ) : (
                            <>Conviction carries between rounds but decays, so you can never stockpile past the
                            hoard ceiling = income ÷ (1 − decay) ={" "}
                            <span className="font-mono text-text-dim">{Math.round(econ.income / Math.max(0.001, 1 - econ.decayAlpha))}</span>.</>
                          )}{" "}
                          All values are GM dials — re-tune any time between rounds.
                        </p>
                      </RuleSection>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer — back + start */}
            <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-bg-base/40 px-8 py-4 backdrop-blur-md">
              <button
                onClick={() => setStep("board")}
                className="rounded-full border border-white/10 px-4 py-2 text-[12px] font-medium text-text-secondary transition hover:bg-white/5"
              >
                ◂ Back to table
              </button>
              <button
                onClick={() => (priorGame ? setConfirmCarryOpen(true) : start(false))}
                disabled={!canStart}
                className="rounded-full bg-violet-500 px-5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start game ▸
              </button>
            </div>
          </>
        )}
      </div>

      {/* Carry-over confirm — a prior game on this branch left conviction balances;
          ask whether to carry them over or restart fresh before creating the game. */}
      {confirmCarryOpen && priorGame && (
        <Modal onClose={() => setConfirmCarryOpen(false)} size="sm">
          <ModalHeader onClose={() => setConfirmCarryOpen(false)}>Carry over conviction?</ModalHeader>
          <div className="flex flex-col gap-4 p-5">
            <p className="text-[12px] leading-relaxed text-text-secondary">
              The last game on this branch left each seat with a conviction balance. Carry those
              balances into the new game, or restart everyone from the fresh{" "}
              <span className="font-mono tabular-nums">{econ.start}</span>?
            </p>
            <div className="flex flex-col gap-1.5 rounded-md bg-white/2 px-3 py-2.5 text-[10px] leading-relaxed text-text-dim/70">
              <span>
                <span className="text-text-secondary">Carry over</span> — returning players keep their last
                balance; new players get the fresh{" "}
                <span className="font-mono tabular-nums">{econ.start}</span>.
              </span>
              <span>
                <span className="text-text-secondary">Restart</span> — every seat starts at{" "}
                <span className="font-mono tabular-nums">{econ.start}</span> conviction.
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmCarryOpen(false);
                  start(false);
                }}
                className="rounded-full border border-white/10 px-4 py-2 text-[12px] font-medium text-text-secondary transition hover:bg-white/5"
              >
                Restart fresh
              </button>
              <button
                onClick={() => {
                  setConfirmCarryOpen(false);
                  start(true);
                }}
                className="rounded-full bg-violet-500 px-5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-400"
              >
                Carry over ▸
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Prominence/relevance tag pill — uniform neutral styling across all ranks. */
function TagPill({ tag }: { tag: string }) {
  return (
    <span className="shrink-0 rounded bg-white/5 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-text-dim/60">
      {tag}
    </span>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-white/8 bg-white/2 px-2.5 focus-within:border-white/16">
      <IconSearch size={13} className="shrink-0 text-text-dim/45" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none"
      />
      {value && (
        <button onClick={() => onChange("")} className="shrink-0 text-text-dim/40 hover:text-text-primary" title="Clear">
          <IconClose size={12} />
        </button>
      )}
    </div>
  );
}

/** A titled rules card with an optional one-line description + corner aside. */
function RuleSection({
  title,
  desc,
  aside,
  children,
}: {
  title: string;
  desc?: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-3.5 p-4 ${CARD}`}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-text-secondary">{title}</span>
          {desc && <span className="text-[10px] leading-relaxed text-text-dim/60">{desc}</span>}
        </div>
        {aside && <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-text-dim/45">{aside}</span>}
      </div>
      <div className="h-px bg-white/6" />
      {children}
    </section>
  );
}

/** A full-width label + control row (for segmented choices). */
function SegRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim">{label}</label>
      {children}
    </div>
  );
}

/** A stacked numeric setting — label + live value above, slider below. */
function SliderTile({
  label,
  hint,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.13em] text-text-dim">{label}</span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-text-primary">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-400"
      />
      {hint && <span className="text-[9px] leading-tight text-text-dim/45">{hint}</span>}
    </div>
  );
}

/** A numeric setting with a "No cap" toggle — when uncapped, the slider greys out
 *  and the value reads ∞. The cap value is preserved so toggling back restores it. */
function CapSliderTile({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  uncapped,
  onChange,
  onUncap,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  uncapped: boolean;
  onChange: (v: number) => void;
  onUncap: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.13em] text-text-dim">{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onUncap(!uncapped)}
            className={`rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider transition ${
              uncapped ? "bg-violet-500/25 text-violet-200" : "bg-white/5 text-text-dim/55 hover:text-text-secondary"
            }`}
          >
            No cap
          </button>
          <span className="font-mono text-[12px] tabular-nums text-text-primary">
            {uncapped ? "∞" : format ? format(value) : value}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={uncapped}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full accent-violet-400 ${uncapped ? "opacity-40" : ""}`}
      />
      {hint && <span className="text-[9px] leading-tight text-text-dim/45">{hint}</span>}
    </div>
  );
}

function EconTile({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <SliderTile
      label={label}
      hint={hint}
      value={value}
      min={min}
      max={max}
      step={step}
      display={format ? format(value) : String(value)}
      onChange={onChange}
    />
  );
}

function TimerTile({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <SliderTile
      label={label}
      hint={hint}
      value={value}
      min={0}
      max={240}
      step={5}
      display={value === 0 ? "Off" : `${value}s`}
      onChange={onChange}
    />
  );
}
