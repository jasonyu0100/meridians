/** Seatable roster — the pure normalisation shared by Conviction SETUP and the
 *  mid-game "add players" modal. Any entity with agency can take a seat
 *  (characters, load-bearing locations, key artifacts); this flattens the three
 *  kinds into one prominence-sorted list with uniform tags + a stable colour
 *  index, so both surfaces present the roster identically. No React, no IO. */
import type { NarrativeState } from "@/types/narrative";

export type SeatKind = "character" | "location" | "artifact";

/** A roster entry, normalised across the three seatable entity kinds so a
 *  sidebar can sort + label them uniformly. `rank` is the prominence order
 *  (0 = most prominent) used for sorting; `tag` is its human label. */
export interface SeatableEntity {
  id: string;
  name: string;
  kind: SeatKind;
  tag: string;
  rank: number;
}

/** Prominence rank per kind — anchor/domain/key lead. */
const ROLE_RANK: Record<string, number> = { anchor: 0, recurring: 1, transient: 2 };
const PROM_RANK: Record<string, number> = { domain: 0, place: 1, margin: 2 };
const SIG_RANK: Record<string, number> = { key: 0, notable: 1, minor: 2 };

export const KIND_TABS: { kind: SeatKind; label: string }[] = [
  { kind: "character", label: "Characters" },
  { kind: "location", label: "Locations" },
  { kind: "artifact", label: "Artifacts" },
];

export interface SeatableRoster {
  /** Prominence-sorted entries per kind. */
  byKind: Record<SeatKind, SeatableEntity[]>;
  /** Flat id → entry lookup across all kinds. */
  entityMap: Map<string, SeatableEntity>;
  /** Stable id → palette index (for per-seat ribbon colours). */
  colorIndex: Record<string, number>;
}

/** Build the normalised, prominence-sorted roster from a narrative's entities. */
export function buildSeatableRoster(narrative: NarrativeState | null): SeatableRoster {
  const chars: SeatableEntity[] = Object.values(narrative?.characters ?? {}).map((c) => ({
    id: c.id,
    name: c.name,
    kind: "character",
    tag: c.role,
    rank: ROLE_RANK[c.role] ?? 9,
  }));
  const locs: SeatableEntity[] = Object.values(narrative?.locations ?? {}).map((l) => ({
    id: l.id,
    name: l.name,
    kind: "location",
    tag: l.prominence,
    rank: PROM_RANK[l.prominence] ?? 9,
  }));
  const arts: SeatableEntity[] = Object.values(narrative?.artifacts ?? {}).map((a) => ({
    id: a.id,
    name: a.name,
    kind: "artifact",
    tag: a.significance,
    rank: SIG_RANK[a.significance] ?? 9,
  }));
  const sort = (xs: SeatableEntity[]) =>
    [...xs].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const byKind: Record<SeatKind, SeatableEntity[]> = {
    character: sort(chars),
    location: sort(locs),
    artifact: sort(arts),
  };
  const flat = [...chars, ...locs, ...arts];
  const entityMap = new Map(flat.map((e) => [e.id, e]));
  const colorIndex = Object.fromEntries(flat.map((e, i) => [e.id, i]));
  return { byKind, entityMap, colorIndex };
}
