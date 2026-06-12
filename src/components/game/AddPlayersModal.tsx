/** Add players to a LIVE Conviction game (CONCEPT.md §The game loop). The same
 *  seat-setup metaphor as GameSetup's board step — a searchable, prominence-sorted
 *  roster on the left, driver tuning (agent persona / member / GM) on the right —
 *  but scoped to a running room: entities already seated are filtered out, and a
 *  confirmed seat joins as `pending` (it's on the rail straight away, but doesn't
 *  get a hand or a turn until the NEXT round opens). Perspectives are created on
 *  the fly for any seated entity that lacks one, exactly as in setup. */
"use client";
import { useMemo, useState } from "react";

import { Avatar, uid } from "@/components/stage/RoomUI";
import { Modal, ModalHeader } from "@/components/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { IconSearch, IconClose } from "@/components/icons";
import { BUILTIN_AGENTS } from "@/lib/agents/personas";
import { SCENARIO_COLORS } from "@/lib/ai/variables";
import { KIND_TABS, buildSeatableRoster, type SeatKind } from "@/lib/game/roster";
import { useStore } from "@/lib/state/store";
import type {
  AgentPersonaKey,
  GameRoom,
  NarrativeState,
  Perspective,
  PerspectiveKind,
  Seat,
} from "@/types/narrative";

type Driver = "agent" | "human" | "gm-proxy";

interface SeatDraft {
  kind: SeatKind;
  entityId: string;
  driver: Driver;
  persona: AgentPersonaKey;
  memberId?: string;
}

/** One configured seat handed back to the hook's `addSeat`. */
export interface AddSeatConfig {
  perspectiveId: string;
  driver: Seat["driver"];
  memberId?: string;
  agentId?: string;
  locationId: string;
}

const DRIVER_LABEL: Record<Driver, string> = { agent: "Agent", human: "Member", "gm-proxy": "GM" };

export function AddPlayersModal({
  room,
  onAdd,
  onClose,
}: {
  room: GameRoom;
  /** Seat the configured players (each joins pending → next round). */
  onAdd: (configs: AddSeatConfig[]) => void;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative as NarrativeState | null;

  const members = useMemo(() => Object.values(narrative?.members ?? {}), [narrative]);
  const { byKind, entityMap, colorIndex } = useMemo(() => buildSeatableRoster(narrative), [narrative]);

  // Entity refs already at the table — filtered out of the roster (no double-seat).
  const seatedRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const seat of Object.values(room.seats)) {
      const ref = narrative?.perspectives?.[seat.perspectiveId]?.entityRef;
      if (ref) refs.add(ref);
    }
    return refs;
  }, [room.seats, narrative]);

  const defaultLocationId = useMemo(
    () => room.locations[0] ?? Object.keys(narrative?.locations ?? {})[0] ?? "",
    [room.locations, narrative],
  );

  const [drafts, setDrafts] = useState<Record<string, SeatDraft>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindTab, setKindTab] = useState<SeatKind>("character");
  const [query, setQuery] = useState("");

  const draftList = Object.values(drafts);
  const nameOf = (id: string) => entityMap.get(id)?.name ?? "—";
  const colorFor = (id: string) => SCENARIO_COLORS[(colorIndex[id] ?? 0) % SCENARIO_COLORS.length];

  const seat = (kind: SeatKind, id: string) =>
    setDrafts((prev) => {
      if (prev[id]) return prev;
      setSelectedId(id);
      return { ...prev, [id]: { kind, entityId: id, driver: "agent", persona: "strategist", memberId: members[0]?.id } };
    });

  const unseat = (id: string) =>
    setDrafts((prev) => {
      if (!prev[id]) return prev;
      const rest = { ...prev };
      delete rest[id];
      setSelectedId((cur) => (cur === id ? null : cur));
      return rest;
    });

  const update = (id: string, patch: Partial<SeatDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Resolve-or-create each draft's perspective (same as GameSetup.start), then
  // hand the seat configs to the hook. New perspectives are upserted here.
  const confirm = () => {
    const configs: AddSeatConfig[] = draftList.map((d) => {
      let persp = Object.values(narrative?.perspectives ?? {}).find(
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
    onAdd(configs);
    onClose();
  };

  const humanWithoutMember = draftList.some((d) => d.driver === "human" && members.length === 0);
  const canAdd = draftList.length >= 1 && !humanWithoutMember;
  const selected = selectedId ? drafts[selectedId] : null;

  const q = query.trim().toLowerCase();
  const roster = byKind[kindTab].filter((e) => !seatedRefs.has(e.id));
  const filtered = q ? roster.filter((e) => e.name.toLowerCase().includes(q)) : roster;

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="80vh">
      <ModalHeader onClose={onClose}>Add players</ModalHeader>
      <div className="flex min-h-0 flex-1">
        {/* Roster — searchable, prominence-sorted, minus who's already seated */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-bg-base/40">
          <div className="flex flex-col gap-2.5 px-3.5 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.15em] text-text-dim">Roster</span>
              <span className="text-[10px] tabular-nums text-text-dim/50">· {draftList.length} to add</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-white/8 bg-white/2 px-2.5 focus-within:border-white/16">
              <IconSearch size={13} className="shrink-0 text-text-dim/45" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${kindTab}s…`}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")} className="shrink-0 text-text-dim/40 hover:text-text-primary" title="Clear">
                  <IconClose size={12} />
                </button>
              )}
            </div>
            <Segmented<SeatKind>
              size="sm"
              value={kindTab}
              onChange={setKindTab}
              options={KIND_TABS.map((t) => ({ value: t.kind, label: t.label }))}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-text-dim/50">
                {q ? `No matches for “${query}”.` : `No more ${kindTab}s to seat.`}
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filtered.map((e) => {
                  const drafted = drafts[e.id];
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
                        onClick={() => (drafted ? setSelectedId(e.id) : seat(e.kind, e.id))}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <div className="rounded-full" style={drafted ? { boxShadow: `0 0 0 2px ${colorFor(e.id)}` } : undefined}>
                          <Avatar label={e.name} size={28} dim={!drafted} />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={`truncate text-[12.5px] ${drafted ? "text-text-primary" : "text-text-secondary"}`}>
                              {e.name}
                            </span>
                            <span className="shrink-0 rounded bg-white/5 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-text-dim/60">
                              {e.tag}
                            </span>
                          </span>
                          {drafted && (
                            <span className="block text-[9px] uppercase tracking-wider text-accent/80">
                              {DRIVER_LABEL[drafted.driver]}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => (drafted ? unseat(e.id) : seat(e.kind, e.id))}
                        title={drafted ? `Remove ${e.name}` : `Add ${e.name}`}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-none transition ${
                          drafted
                            ? "text-text-dim/50 hover:bg-rose-500/20 hover:text-rose-300"
                            : "bg-violet-500/90 text-white hover:bg-violet-400"
                        }`}
                      >
                        {drafted ? "×" : "+"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Driver tuning for the selected draft + the "to add" summary */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {draftList.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="text-[13px] text-text-secondary">No players selected yet</span>
                <span className="max-w-64 text-[11px] leading-relaxed text-text-dim/60">
                  Pick entities from the roster to seat them. They join when the next round starts.
                </span>
              </div>
            ) : selected ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-2 text-center">
                <span className="text-[10px] uppercase tracking-[0.22em] text-text-dim/70">Driving this seat</span>
                <div className="rounded-full" style={{ boxShadow: `0 0 0 2px ${colorFor(selected.entityId)}` }}>
                  <Avatar label={nameOf(selected.entityId)} size={48} ai={selected.driver === "agent"} />
                </div>
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
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="text-[11px] text-text-dim/60">Select a drafted player to tune its driver.</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-bg-base/40 px-6 py-4">
            <span className="text-[11px] text-text-dim">
              {draftList.length} to add
              {humanWithoutMember && <span className="ml-2 text-amber-400/80">— add a member or change driver</span>}
              {draftList.length > 0 && !humanWithoutMember && (
                <span className="ml-2 text-text-dim/50">· joins next round</span>
              )}
            </span>
            <button
              onClick={confirm}
              disabled={!canAdd}
              className="rounded-full bg-violet-500 px-5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add {draftList.length || ""} player{draftList.length === 1 ? "" : "s"} ▸
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
