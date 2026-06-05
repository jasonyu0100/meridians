/**
 * Entity-reference resolution for chat annotations.
 *
 * The chat models are encouraged to annotate the entities they mention with a
 * bracketed id — `[C-12]`, `[T-8]`, `[SYS-4]`, `[S-117]`, `[ARC-3]`. Those
 * brackets are detected at render time (see `Markdown` + `EntityRef`) and
 * resolved here, deterministically, into a human-readable chip: the entity's
 * name, a type label, a short supporting detail, and the inspector context a
 * click should navigate to.
 *
 * Resolution is a direct keyed lookup against the active narrative — no LLM,
 * no fuzzy matching. An id that doesn't resolve renders as inert text, so a
 * hallucinated id can never masquerade as a real entity.
 */

import type { InspectorContext, NarrativeState } from "@/types/narrative";

export type EntityRefKind =
  | "character"
  | "location"
  | "artifact"
  | "thread"
  | "scene"
  | "arc"
  | "knowledge";

export type EntityRefInfo = {
  id: string;
  kind: EntityRefKind;
  /** Human-readable label shown in the inline chip. */
  label: string;
  /** Capitalised type word for the hover-card header. */
  typeLabel: string;
  /** Short supporting detail for the hover card (may be empty). */
  detail: string;
  /** Where a click should navigate in the inspector. */
  inspector: InspectorContext;
};

/** Leading id token (before the first `-`) → entity kind. */
const PREFIX_KIND: Record<string, EntityRefKind> = {
  C: "character",
  L: "location",
  A: "artifact",
  T: "thread",
  S: "scene",
  ARC: "arc",
  SYS: "knowledge",
  K: "knowledge",
};

/**
 * Body of a recognised reference: a known prefix, then the canonical
 * `<PREFIX>-<N>` or work-scoped `<PREFIX>-<WORK>-<N>` tail. Longer prefixes
 * (ARC, SYS) are listed first so the alternation prefers them over A / S.
 */
const REF_BODY = "(?:ARC|SYS|C|L|A|T|S|K)-(?:[A-Za-z0-9]+-)*\\d+";

/** Source for the bracketed-annotation pattern, e.g. `[C-12]`. The trailing
 *  `(?!\\()` skips tokens that are actually markdown link labels (`[x](url)`). */
export const ENTITY_REF_REGEX_SOURCE = `\\[(${REF_BODY})\\](?!\\()`;

/** Fresh global RegExp for the bracketed-annotation pattern (stateful `g`
 *  flag — always mint a new one rather than sharing `lastIndex`). */
export function entityRefRegex(): RegExp {
  return new RegExp(ENTITY_REF_REGEX_SOURCE, "g");
}

/**
 * Scan a message body and assign each distinct bracketed id a stable citation
 * number in order of first appearance — Perplexity style. Repeated references
 * to the same entity reuse the same number, so `[C-12] … [C-12]` both render
 * as `1`. The returned map is keyed by the trimmed inner id token.
 */
export function buildCitationNumbers(text: string): Map<string, number> {
  const numbers = new Map<string, number>();
  const re = entityRefRegex();
  let next = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].trim();
    if (!numbers.has(id)) numbers.set(id, next++);
  }
  return numbers;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Resolve a bracket id (the inner token, e.g. `C-12`) against the active
 * narrative. Returns null when the prefix is unknown or the id has no
 * matching entity — callers render those as inert text.
 */
export function resolveEntityRef(
  narrative: NarrativeState | null | undefined,
  rawId: string,
): EntityRefInfo | null {
  if (!narrative) return null;
  const id = rawId.trim();
  const prefix = id.split("-")[0];
  const kind = PREFIX_KIND[prefix];
  if (!kind) return null;

  switch (kind) {
    case "character": {
      const c = narrative.characters?.[id];
      if (!c) return null;
      return {
        id,
        kind,
        label: c.name,
        typeLabel: "Character",
        detail: c.role ? `${capitalize(c.role)} character` : "",
        inspector: { type: "character", characterId: id },
      };
    }
    case "location": {
      const l = narrative.locations?.[id];
      if (!l) return null;
      return {
        id,
        kind,
        label: l.name,
        typeLabel: "Location",
        detail: l.prominence ? `${capitalize(l.prominence)}` : "",
        inspector: { type: "location", locationId: id },
      };
    }
    case "artifact": {
      const a = narrative.artifacts?.[id];
      if (!a) return null;
      return {
        id,
        kind,
        label: a.name,
        typeLabel: "Artifact",
        detail: a.significance ? `${capitalize(a.significance)} artifact` : "",
        inspector: { type: "artifact", artifactId: id },
      };
    }
    case "thread": {
      const t = narrative.threads?.[id];
      if (!t) return null;
      return {
        id,
        kind,
        label: t.description,
        typeLabel: "Thread",
        detail: "",
        inspector: { type: "thread", threadId: id },
      };
    }
    case "scene": {
      const s = narrative.scenes?.[id];
      if (!s) return null;
      return {
        id,
        kind,
        label: s.summary || id,
        typeLabel: "Scene",
        detail: "",
        inspector: { type: "scene", sceneId: id },
      };
    }
    case "arc": {
      const arc = narrative.arcs?.[id];
      if (!arc) return null;
      return {
        id,
        kind,
        label: arc.name || id,
        typeLabel: "Arc",
        detail: arc.directionVector ?? "",
        inspector: { type: "arc", arcId: id },
      };
    }
    case "knowledge": {
      const node = narrative.systemGraph?.nodes?.[id];
      if (!node) return null;
      return {
        id,
        kind,
        label: node.concept,
        typeLabel: capitalize(node.type),
        detail: "",
        inspector: { type: "knowledge", nodeId: id },
      };
    }
  }
  return null;
}
