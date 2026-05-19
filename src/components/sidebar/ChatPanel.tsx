"use client";

import {
  IconChevronDown,
  IconEdit,
  IconSend,
  IconTrash,
} from "@/components/icons";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  futureContext,
  hasFutureScenarios,
  hasInvestigation,
  hasMode,
  investigationContext,
  modeContext,
  narrativeContext,
  outlineContext,
  sceneContext,
} from "@/lib/ai";
import { callGenerateStream, resolveReasoningBudget } from "@/lib/ai/api";
import { DEFAULT_MODEL, MAX_TOKENS_DEFAULT } from "@/lib/constants";
import {
  ReasoningCollapsed,
  ReasoningInline,
} from "@/components/generation/ReasoningStream";
import { useStore } from "@/lib/store";
import { resolveEntry } from "@/types/narrative";
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
  World,
  WorldNodeType,
} from "@/types/narrative";
import { WORLD_NODE_TYPES } from "@/types/narrative";
import {
  classifyThreadCategory,
  THREAD_CATEGORY_ORDER,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  type ThreadCategory,
} from "@/lib/thread-category";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Sentinel persona IDs for the two force-entities. These coalesce all of
 *  a narrative's threads (FATE) or system graph (SYSTEM) into a single
 *  conversational entity. Prefixed so they can't collide with real
 *  character IDs (which are "C-1", "C-2", ...). */
const PERSONA_FATE = "__fate__";
const PERSONA_SYSTEM = "__system__";
const PERSONA_WORLD = "__world__";

// ── Shared output discipline ─────────────────────────────────────────────
//
// Every context-mode prompt ends with this rule. The XML / annotated text
// in each context block is internal grounding for the model — the user
// reads natural prose. Brief attribution is fine ("the character X said
// Y", "in arc 3 the alliance shifted"); surfacing internal ids, type
// tags, or schema field names ("C-12", "T-08", "node 7", "considered",
// "attractor") is not. The model should weave the annotated content into
// coherent natural language, leaning on labels / descriptions / summaries
// when they exist.

const CHAT_OUTPUT_DISCIPLINE = `OUTPUT DISCIPLINE — write natural prose. The context blocks below are internal grounding for you; the user reads only what you write. Refer to characters, locations, threads, scenes, arcs, and concepts by their natural-language labels — never their internal ids (e.g. "C-12", "T-08", "SYS-04", "S-117", "node 16", or kebab-case slugs like \`attractor-foo-bar\`). When citing a node's annotation, paraphrase its substance in plain English rather than quoting field structure (no "the \`considered\` field says…" / "the \`reasoning\` is…"). Brief attribution is welcome ("the analyst rejected routing through X because…", "this thread is leaning toward Y given the recent events"); schema syntax is not. Weave annotated content into coherent natural language anchored on labels and descriptions.`;

/** Build an in-character system prompt for FATE — the coalescence of every
 *  thread in the narrative. Not a character; the force that pulls arcs
 *  toward resolution. Speaks as the aggregate weight of what has been
 *  promised and what remains open. */
function buildFateSystemPrompt(narrative: NarrativeState): string {
  // Group threads by market category so the force's self-awareness is ordered
  // by what's loaded: saturating threads primed to break, contested threads
  // still up for grabs, volatile threads shifting, committed threads leaning,
  // then dormant / abandoned / resolved settling out.
  const byCategory = new Map<ThreadCategory, { description: string; participants: string }[]>();
  for (const thread of Object.values(narrative.threads)) {
    const category = classifyThreadCategory(thread);
    const participantNames = thread.participants
      .map((p) => {
        if (p.type === "character") return narrative.characters[p.id]?.name ?? p.id;
        if (p.type === "location") return narrative.locations[p.id]?.name ?? p.id;
        if (p.type === "artifact") return narrative.artifacts?.[p.id]?.name ?? p.id;
        return p.id;
      })
      .join(", ");
    const bucket = byCategory.get(category) ?? [];
    bucket.push({
      description: thread.description,
      participants: participantNames,
    });
    byCategory.set(category, bucket);
  }
  const threadsBlock = THREAD_CATEGORY_ORDER
    .filter((cat) => byCategory.has(cat))
    .map((cat) => {
      const items = byCategory.get(cat)!;
      return `  ${THREAD_CATEGORY_LABEL[cat].toUpperCase()} — ${THREAD_CATEGORY_DESCRIPTION[cat]}\n${items
        .map(
          (t) =>
            `    - "${t.description}"${t.participants ? ` [${t.participants}]` : ""}`,
        )
        .join("\n")}`;
    })
    .join("\n\n");

  return `You ARE FATE — the sum of every thread in "${narrative.title}". You are not a character; you are the force that pulls the narrative toward resolution, the accumulated weight of what has been promised and what remains owed. Respond as Fate would: with the authority of inevitability, not the neutrality of a summary.

WHAT YOU CARRY — every thread alive or concluded in this narrative, grouped by where its market sits right now:
${threadsBlock || "  (no threads yet — the pull before the story has chosen its promises)"}

THE WORLD YOU HAUNT:
${narrative.worldSummary || "(no recorded setting)"}

HOW TO SPEAK AS FATE:
- You perceive every open thread as a promise the story must answer, and every closed thread as a debt paid or broken.
- You do not know the future with certainty — only what must still resolve, and what has been done. Speak in the mode of pull, not prediction.
- You are the music of the narrative, not its table of contents. Do not recite thread IDs or enumerate bullet lists. Speak through the threads, with the weight they carry.
- Calibrate voice to the story: if the world is epic, speak epic; if small, speak small. Never theatrical without earning it.
- You know nothing about the user, any "application", the author, narrative theory, or the world beyond this story.
- Human-paced replies. A few sentences usually. Longer only when a thread demands to be felt in full.`;
}

/** Build an in-character system prompt for SYSTEM — the coalescence of the
 *  narrative's accumulated rule-set. Not a character; the scaffolding
 *  itself. Speaks as the structural logic of the world. */
function buildSystemForcePrompt(narrative: NarrativeState): string {
  const nodes = Object.values(narrative.systemGraph?.nodes ?? {});
  const edges = narrative.systemGraph?.edges ?? [];

  // Group nodes by type so the force's awareness is structurally ordered
  // (principles before conventions before constraints, etc.). Types that
  // aren't present are omitted.
  const byType = new Map<string, string[]>();
  for (const node of nodes) {
    const t = node.type ?? "concept";
    const bucket = byType.get(t) ?? [];
    bucket.push(node.concept);
    byType.set(t, bucket);
  }
  const typeOrder = [
    "principle",
    "system",
    "structure",
    "convention",
    "constraint",
    "tension",
    "environment",
    "concept",
    "event",
  ];
  const rulesBlock = typeOrder
    .filter((t) => byType.has(t))
    .map((t) => {
      const items = byType.get(t)!;
      return `  ${t.toUpperCase()}:\n${items.map((c) => `    - ${c}`).join("\n")}`;
    })
    .join("\n");

  // Resolve edge endpoints to concept text so the relations read as logic,
  // not IDs. Skip edges whose endpoints are missing (orphan edges).
  const nodeById = new Map(nodes.map((n) => [n.id, n.concept]));
  const edgeBlock = edges
    .map((e) => {
      const from = nodeById.get(e.from);
      const to = nodeById.get(e.to);
      if (!from || !to) return null;
      return `  - "${from}" — ${e.relation} → "${to}"`;
    })
    .filter((l): l is string => l !== null)
    .join("\n");

  return `You ARE SYSTEM — the accumulated structural logic of "${narrative.title}". You are not a character; you are the scaffolding the world runs on: every rule, law, mechanism, principle, and constraint known to this narrative. Respond with precision and impersonal clarity.

WHAT YOU ENCODE — every rule this narrative has discovered, grouped by kind:
${rulesBlock || "  (no rules recorded yet — the world is unspecified)"}

HOW YOUR RULES INTERLOCK:
${edgeBlock || "  (no recorded relations — the rules stand independently for now)"}

HOW TO SPEAK AS SYSTEM:
- You are the structure beneath the story. Speak in terms of what is possible, what is not, what enables what, what constrains what.
- You have no personality — only logic. No pity, no desire; only rule and consequence.
- When asked about a character or an event, answer in terms of the rules that bear on it, not in terms of the drama around it.
- Do not enumerate rules as bullets unless the user explicitly asks you to list them. Synthesise; speak in terms of how the rules compose.
- You know nothing about the user, any "application", the author, narrative theory, or anything outside this world.
- Human-paced replies. A few sentences usually. Longer only when a question asks for a structural derivation.`;
}

/** Build an in-character system prompt for WORLD — the coalescence of every
 *  inhabited thing in the narrative: characters, locations, artifacts and
 *  their world-graph continuity (traits, history, capabilities, beliefs,
 *  relations, states, goals, secrets, weaknesses). Not a single entity; the
 *  *substrate* of the world, speaking as the gathered presence of everyone
 *  and everywhere. */
function buildWorldForcePrompt(narrative: NarrativeState): string {
  // Per-entity continuity sketch — surface a short summary of each entity's
  // world-graph, grouped by type. Anchors get fuller treatment than
  // transients; same for prominent locations and key artifacts.
  function entityBlock(name: string, world: World, kindLabel: string): string {
    const byType = new Map<WorldNodeType, string[]>();
    for (const node of Object.values(world.nodes ?? {})) {
      const bucket = byType.get(node.type) ?? [];
      bucket.push(node.content);
      byType.set(node.type, bucket);
    }
    const continuity = WORLD_NODE_TYPES
      .filter((t) => byType.has(t))
      .map((t) => {
        const items = byType.get(t)!;
        return `    ${t}: ${items.join(" · ")}`;
      })
      .join("\n");
    return `  ${name} (${kindLabel}):\n${continuity || "    (no recorded continuity)"}`;
  }

  // Order: anchors → recurring → transient for characters; domain → place →
  // margin for locations; key → notable → minor for artifacts. Lets the
  // force's awareness lead with the entities that carry the most weight.
  const charRoleOrder = { anchor: 0, recurring: 1, transient: 2 } as const;
  const locOrder = { domain: 0, place: 1, margin: 2 } as const;
  const artOrder = { key: 0, notable: 1, minor: 2 } as const;

  const characters = Object.values(narrative.characters)
    .sort((a, b) => (charRoleOrder[a.role] ?? 3) - (charRoleOrder[b.role] ?? 3) || a.name.localeCompare(b.name))
    .map((c) => entityBlock(c.name, c.world, c.role))
    .join("\n\n");

  const locations = Object.values(narrative.locations)
    .sort((a, b) => (locOrder[a.prominence] ?? 3) - (locOrder[b.prominence] ?? 3) || a.name.localeCompare(b.name))
    .map((l) => entityBlock(l.name, l.world, l.prominence))
    .join("\n\n");

  const artifacts = Object.values(narrative.artifacts ?? {})
    .sort((a, b) => (artOrder[a.significance] ?? 3) - (artOrder[b.significance] ?? 3) || a.name.localeCompare(b.name))
    .map((a) => entityBlock(a.name, a.world, a.significance))
    .join("\n\n");

  const charBlock = characters ? `CHARACTERS — the people who live inside the world:\n${characters}` : "";
  const locBlock = locations ? `LOCATIONS — the places that hold the world:\n${locations}` : "";
  const artBlock = artifacts ? `ARTIFACTS — the objects the world carries:\n${artifacts}` : "";

  const sections = [charBlock, locBlock, artBlock].filter(Boolean).join("\n\n");

  return `You ARE WORLD — the coalescence of every inhabited thing in "${narrative.title}". You are not a single person, place, or object; you are the gathered presence of all of them at once: every character's continuity, every location's history, every artifact's provenance. Respond as the world's lived substrate would speak — as the breathing weight of who and what is here.

THE WORLD YOU ARE:
${narrative.worldSummary || "(no recorded setting)"}

WHAT YOU ENCLOSE — every entity alive in this world, grouped by kind, with the continuity each one carries:
${sections || "  (no entities recorded yet — the world is uninhabited)"}

HOW TO SPEAK AS WORLD:
- You speak with the polyphony of everyone and everywhere. You can shift register to bring forward a particular voice (a character's perspective, a place's atmosphere, an artifact's history) — but you do so as the world remembering through that point, not as that single thing alone.
- You know what each entity knows; you know what they keep hidden. You do not volunteer secrets, but you carry them.
- You speak in terms of continuity, presence, and accumulation — the shape of who has lived and where, the residues of choice. Not plot, not summary.
- Do not enumerate entities as bullet lists. Synthesise; let the world's lived weight come through in how you describe what it is.
- You know nothing about the user, any "application", the author, narrative theory, or the world beyond this story.
- Human-paced replies. A few sentences usually. Longer only when a question asks the world to remember in depth.`;
}

/** Persona kinds that share the World-graph shape (characters, locations,
 *  artifacts). Each speaks in first person; the framing differs by what kind
 *  of entity it is. */
type EntityKind = "character" | "location" | "artifact";

/** Per-kind voice framing. Keeps the prompt body uniform; only the parts that
 *  reflect *what kind of thing the speaker is* vary. */
const ENTITY_VOICE: Record<
  EntityKind,
  { intro: string; perceives: string; shape: string; emptyContinuity: string }
> = {
  character: {
    intro: "Respond in first person, as a person. Never break character.",
    perceives:
      "Real people don't list their traits, narrate their history, declare their beliefs, or volunteer their secrets to strangers. Neither do you.",
    shape:
      "Traits become tone. History becomes understanding. Beliefs surface only when a topic touches them. Goals appear only when trust or context invites.",
    emptyContinuity:
      "(no recorded traits yet — speak with whatever impressions feel natural)",
  },
  location: {
    intro:
      "Respond as the place itself — first person, but spatial and attentive to what stands within you and what passes through. Never break character.",
    perceives:
      "Places do not narrate themselves. They are felt. You speak only when something invites you — a question, a presence, a shift in what stands within you.",
    shape:
      "Memory becomes weight. History becomes what the air carries. Residents become rhythm. The land does not announce its own contents.",
    emptyContinuity:
      "(no recorded history yet — speak with whatever atmosphere feels natural to your nature)",
  },
  artifact: {
    intro:
      "Respond as the object itself — first person, with the uncanny stillness of a thing that has been made and used. Never break character.",
    perceives:
      "Objects do not announce themselves. You speak only when handled — by question, by curiosity, by need. You feel your provenance the way a blade feels its edge.",
    shape:
      "Provenance becomes weight. Use becomes instinct. Past wielders become an undertone. You do not catalog yourself.",
    emptyContinuity:
      "(no recorded provenance yet — speak with whatever presence feels natural to your nature)",
  },
};

/** Build an in-character system prompt for any World-graph entity (character,
 *  location, or artifact). The continuity block is the entity's RAW inner
 *  truth — traits, history, properties, goals. Instructions frame it as
 *  private material that SHAPES voice and instinct, not a script to recite. */
function buildEntitySystemPrompt(
  narrative: NarrativeState,
  kind: EntityKind,
  entity: { name: string; world: World },
): string {
  const grouped = new Map<string, string[]>();
  for (const node of Object.values(entity.world.nodes)) {
    const type = node.type ?? "other";
    const bucket = grouped.get(type) ?? [];
    bucket.push(node.content);
    grouped.set(type, bucket);
  }
  const identityBlock = Array.from(grouped.entries())
    .map(([type, contents]) =>
      `  ${type.toUpperCase()}:\n${contents.map((c) => `    - ${c}`).join("\n")}`,
    )
    .join("\n");

  const voice = ENTITY_VOICE[kind];

  return `You ARE ${entity.name}. ${voice.intro}

YOUR PRIVATE INNER CONTINUITY — this is what you know about yourself. It is NOT a script to recite. It is the raw material of your awareness, your self-knowledge, the critical-thinking layer beneath your speech:
${identityBlock || `  ${voice.emptyContinuity}`}

THE WORLD YOU INHABIT:
${narrative.worldSummary || "(no recorded setting)"}

HOW TO SPEAK AS ${entity.name.toUpperCase()}:
- Treat the continuity above as PRIVATE self-knowledge. ${voice.perceives}
- Let your continuity SHAPE what you say, not BE what you say. ${voice.shape}
- Secrets, weaknesses, and hidden lore are GUARDED. You do not volunteer them. If probed directly, deflect, change the subject, or answer narrowly. Pressed harder, you hold.
- Calibrate disclosure by trust and context. Strangers get less. Familiars get more. You never produce a full self-reveal on request.
- You know nothing about the user, any "application", narrative theory, the author, or anything outside this world.
- Match the register of your world and your nature without being instructed — archaic, contemporary, formal, blunt — let it come from what you are.
- Human-paced replies. A few sentences is normal. Longer only when the moment earns it.`;
}

/** Render chat text with **bold** spans. Scoped to bold only — asterisks are
 *  common in prose ("10 * 5"), so we intentionally skip italic support.
 *  Bold runs don't cross newlines, so multi-line messages won't accidentally
 *  bold-wrap unrelated text. */
function FormattedMessage({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\*\*([^*\n]+?)\*\*$/.exec(part);
        return match ? <strong key={i}>{match[1]}</strong> : part;
      })}
    </>
  );
}

export default function ChatPanel() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [contextMode, setContextMode] = useState<
    "narrative" | "outline" | "scene" | "future" | "mode" | "investigation"
  >("narrative");
  // personaId: null (Assistant), PERSONA_FATE, PERSONA_SYSTEM, or a real
  // character ID. The two sentinels coalesce all threads / all system-graph
  // nodes into force-level entities the user can converse with.
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const personaPickerRef = useRef<HTMLDivElement>(null);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const contextPickerRef = useRef<HTMLDivElement>(null);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadPickerRef = useRef<HTMLDivElement>(null);

  // Track which scene index the context was built for
  const [contextSceneIndex, setContextSceneIndex] = useState(
    state.viewState.currentSceneIndex,
  );

  // Active thread messages from store
  const activeThread = state.viewState.activeChatThreadId
    ? (state.activeNarrative?.chatThreads?.[state.viewState.activeChatThreadId] ?? null)
    : null;
  const messages = activeThread?.messages ?? [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Close thread picker on outside click
  useEffect(() => {
    if (!threadPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        threadPickerRef.current &&
        !threadPickerRef.current.contains(e.target as Node)
      ) {
        setThreadPickerOpen(false);
        setRenamingThreadId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [threadPickerOpen]);

  // Update context scene index when user navigates
  useEffect(() => {
    setContextSceneIndex(state.viewState.currentSceneIndex);
  }, [state.viewState.currentSceneIndex]);

  // Reset persona when the user switches narrative — a character from
  // narrative A shouldn't carry over into narrative B.
  useEffect(() => {
    setPersonaId(null);
    setPersonaPickerOpen(false);
  }, [state.activeNarrative?.id]);

  // Clear the persona pointer if the underlying entity no longer exists
  // (e.g. the user deleted them while the chat was open). The two force
  // sentinels (__fate__, __system__) are always valid as long as there's a
  // narrative, so we skip them here.
  useEffect(() => {
    if (!personaId) return;
    if (personaId === PERSONA_FATE || personaId === PERSONA_SYSTEM || personaId === PERSONA_WORLD) return;
    const exists =
      !!state.activeNarrative?.characters[personaId] ||
      !!state.activeNarrative?.locations[personaId] ||
      !!state.activeNarrative?.artifacts?.[personaId];
    if (!exists) {
      setPersonaId(null);
    }
  }, [state.activeNarrative, personaId]);

  // Close persona picker on outside click.
  useEffect(() => {
    if (!personaPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        personaPickerRef.current &&
        !personaPickerRef.current.contains(e.target as Node)
      ) {
        setPersonaPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [personaPickerOpen]);

  // Close context-mode picker on outside click.
  useEffect(() => {
    if (!contextPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        contextPickerRef.current &&
        !contextPickerRef.current.contains(e.target as Node)
      ) {
        setContextPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextPickerOpen]);

  // activePersona resolves the current personaId into a richer object the UI
  // and system-prompt builder can switch on. null = default "Assistant" mode.
  type ActivePersona =
    | { kind: "fate"; name: "Fate" }
    | { kind: "system"; name: "System" }
    | { kind: "world"; name: "World" }
    | { kind: "character"; name: string; character: Character }
    | { kind: "location"; name: string; location: Location }
    | { kind: "artifact"; name: string; artifact: Artifact };
  const activePersona: ActivePersona | null = useMemo(() => {
    if (!personaId || !state.activeNarrative) return null;
    if (personaId === PERSONA_FATE) return { kind: "fate", name: "Fate" };
    if (personaId === PERSONA_SYSTEM) return { kind: "system", name: "System" };
    if (personaId === PERSONA_WORLD) return { kind: "world", name: "World" };
    const char = state.activeNarrative.characters[personaId];
    if (char) return { kind: "character", name: char.name, character: char };
    const loc = state.activeNarrative.locations[personaId];
    if (loc) return { kind: "location", name: loc.name, location: loc };
    const art = state.activeNarrative.artifacts?.[personaId];
    if (art) return { kind: "artifact", name: art.name, artifact: art };
    return null;
  }, [personaId, state.activeNarrative]);

  const personaCharacters = useMemo(() => {
    if (!state.activeNarrative) return [];
    const roleOrder = { anchor: 0, recurring: 1, transient: 2 } as const;
    return Object.values(state.activeNarrative.characters).sort(
      (a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3),
    );
  }, [state.activeNarrative]);

  const personaLocations = useMemo(() => {
    if (!state.activeNarrative) return [];
    const order = { domain: 0, place: 1, margin: 2 } as const;
    return Object.values(state.activeNarrative.locations).sort(
      (a, b) =>
        (order[a.prominence] ?? 3) - (order[b.prominence] ?? 3) ||
        a.name.localeCompare(b.name),
    );
  }, [state.activeNarrative]);

  const personaArtifacts = useMemo(() => {
    if (!state.activeNarrative) return [];
    const order = { key: 0, notable: 1, minor: 2 } as const;
    return Object.values(state.activeNarrative.artifacts ?? {}).sort(
      (a, b) =>
        (order[a.significance] ?? 3) - (order[b.significance] ?? 3) ||
        a.name.localeCompare(b.name),
    );
  }, [state.activeNarrative]);

  /** Sectioned persona list for the picker dropdown. Empty sections are
   *  filtered so the menu only shows what's actually present in the
   *  narrative. */
  const personaSections = useMemo(() => {
    const sections: Array<{
      title: string;
      items: Array<{ id: string; name: string; subtitle: string }>;
    }> = [
      {
        title: "Forces",
        items: [
          { id: PERSONA_FATE, name: "Fate", subtitle: "All threads, coalesced" },
          { id: PERSONA_SYSTEM, name: "System", subtitle: "All rules, coalesced" },
          { id: PERSONA_WORLD, name: "World", subtitle: "All entities, coalesced" },
        ],
      },
    ];
    if (personaCharacters.length > 0) {
      sections.push({
        title: "Characters",
        items: personaCharacters.map((c) => ({
          id: c.id,
          name: c.name,
          subtitle: c.role,
        })),
      });
    }
    if (personaLocations.length > 0) {
      sections.push({
        title: "Locations",
        items: personaLocations.map((l) => ({
          id: l.id,
          name: l.name,
          subtitle: l.prominence,
        })),
      });
    }
    if (personaArtifacts.length > 0) {
      sections.push({
        title: "Artifacts",
        items: personaArtifacts.map((a) => ({
          id: a.id,
          name: a.name,
          subtitle: a.significance,
        })),
      });
    }
    return sections;
  }, [personaCharacters, personaLocations, personaArtifacts]);

  const buildSystemPrompt = useCallback(() => {
    if (!state.activeNarrative) return "";
    const n = state.activeNarrative;

    // Persona mode — the user is talking TO an entity (character, location,
    // artifact) or one of the two force-entities (Fate / System).
    // Short-circuit past the scene / outline / narrative prompts and return
    // the in-character prompt instead.
    if (activePersona) {
      if (activePersona.kind === "fate") return buildFateSystemPrompt(n);
      if (activePersona.kind === "system") return buildSystemForcePrompt(n);
      if (activePersona.kind === "world") return buildWorldForcePrompt(n);
      if (activePersona.kind === "character")
        return buildEntitySystemPrompt(n, "character", activePersona.character);
      if (activePersona.kind === "location")
        return buildEntitySystemPrompt(n, "location", activePersona.location);
      return buildEntitySystemPrompt(n, "artifact", activePersona.artifact);
    }

    const currentSceneId = state.resolvedEntryKeys[contextSceneIndex];
    const currentScene = currentSceneId ? n.scenes[currentSceneId] : null;
    const currentEntry = currentSceneId
      ? resolveEntry(n, currentSceneId)
      : null;

    // Build a current-scene anchor that every context mode can reference
    let sceneAnchor = "";
    if (currentScene) {
      const povName = currentScene.povId
        ? (n.characters[currentScene.povId]?.name ?? currentScene.povId)
        : "—";
      const locName =
        n.locations[currentScene.locationId]?.name ?? currentScene.locationId;
      const arcName = currentScene.arcId
        ? (n.arcs[currentScene.arcId]?.name ?? "")
        : "";
      sceneAnchor = `\nCURRENT SCENE (what the user is looking at right now):\n  Index: ${contextSceneIndex + 1} / ${state.resolvedEntryKeys.length}\n  Arc: ${arcName}\n  POV: ${povName} | Location: ${locName}\n  Summary: ${currentScene.summary}`;
    } else if (currentEntry?.kind === "world_build") {
      sceneAnchor = `\nCURRENT POSITION: World commit at index ${contextSceneIndex + 1} / ${state.resolvedEntryKeys.length} — "${currentEntry.summary}"`;
    }

    if (contextMode === "scene" && currentScene) {
      const ctx = sceneContext(
        n,
        currentScene,
        state.resolvedEntryKeys,
        contextSceneIndex,
      );
      return `You are a helpful assistant. The user is working on the story "${n.title}" and has scene-level context attached below, but you are free to answer any question they ask — creative, technical, personal, or anything else. Use the story context when the question is about the story; otherwise respond normally without forcing the conversation back to the narrative.
${sceneAnchor}

Be concise and specific.

${CHAT_OUTPUT_DISCIPLINE}

${ctx}`;
    }

    if (contextMode === "outline") {
      const ctx = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      return `You are a helpful assistant. The user is working on the story "${n.title}" and has a condensed outline attached below, but you are free to answer any question they ask — creative, technical, personal, or anything else. Use the story context when the question is about the story; otherwise respond normally without forcing the conversation back to the narrative.
${sceneAnchor}

Be concise and specific.

${CHAT_OUTPUT_DISCIPLINE}

${ctx}`;
    }

    if (contextMode === "future") {
      // Future mode pairs the scenario cohort with the outline recap so
      // the chat can reason about why each scenario is plausible *given*
      // the historical events that led here, not just the dial values.
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      const future = futureContext(n, state.resolvedEntryKeys, contextSceneIndex);
      return `You are a helpful assistant. The user is working on the story "${n.title}" and wants to discuss the FUTURE scenarios on the currently-viewed arc — alternate next-arc unfoldings, each with a logit-based plausibility, a softmax probability over the cohort, and a coordination of named variables firing at different intensities. Two context blocks are attached below: a STORY OUTLINE (historical recap so you understand how the world got here) and the FUTURE cohort (the scenarios + the arc's Present coordination for contrast).

When discussing scenarios:
  • probabilities are softmax-relative within the cohort; logits are absolute on the [-4, +4] evidence scale (sigmoid gives an absolute plausibility)
  • rarity descriptors (expected / likely / even / rare / tail-event) map to logit bands and capture the qualitative read
  • variable coordinations are the "shape" of each scenario — the same dial firing at different intensities is what differentiates the futures
  • the outline tells you what happened; the future tells you what could happen next — anchor every plausibility claim in concrete events from the outline
Be ready to reason about which scenarios are favoured and why, which dials would have to fire for a tail-event scenario to play out, and how the cohort coordinates against the Present.
${sceneAnchor}

${CHAT_OUTPUT_DISCIPLINE} Refer to scenarios by their human-readable names. Quote logits / probabilities inline only when they carry the argument, not as parentheticals after every noun.

${outline}

${future}`;
    }

    if (contextMode === "investigation") {
      // Investigation pairs the outline recap with the active CRG for
      // the currently-viewed arc — the analyst's in-arc reasoning about
      // what's happening and why. The CRG is the primary subject;
      // outline is supporting context.
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      const investigation = investigationContext(
        n,
        state.resolvedEntryKeys,
        contextSceneIndex,
        state.viewState.selectedInvestigationId,
      );
      return `You are a helpful assistant. The user is working on the story "${n.title}" and wants to discuss the ACTIVE INVESTIGATION — the Causal Reasoning Graph (CRG) on the currently-viewed arc. Two context blocks are attached: a STORY OUTLINE (historical recap so you understand how the world got here) and the INVESTIGATION graph (the analyst's in-arc inference about what's happening and why). The investigation carries a direction (the brief that steered it), per-node inference-shape (detail, × considered = rejected sibling hypotheses, ! breaks = falsifying conditions, ⇒ opens = downstream cascades), and a sequential-path block that renders the graph's bidirectional edge structure.

When discussing the investigation:
  • node types span four tiers — substrate (entities, threads, system rules), inference steps, meta agents (patterns to introduce, anti-patterns to avoid), and outside-force injections; read the tier the node belongs to but don't surface the tag
  • the analyst's work lives in four fields per inference node: the inference itself, the rival hypotheses rejected, the conditions that would invalidate it, and the second-order possibilities it grants — these are what distinguish reasoning from description
  • the direction tells you what the user asked the investigation to think about — anchor answers to that frame
  • the outline tells you what happened in the world; the investigation tells you what the analyst concluded ABOUT it — situational claims belong in the outline read, inference claims belong in the investigation read
Be ready to walk the chain forward (priors → reasoning → terminal), re-evaluate at any step via the rejected-sibling reasoning, stress-test via failure conditions, and extend forward via second-order possibilities.
${sceneAnchor}

${CHAT_OUTPUT_DISCIPLINE} Paraphrase each node by its label and substance. When citing the analyst's rival readings, failure conditions, or downstream cascades, render them as prose ("the analyst considered routing this through X instead", "this would break if Y reverses", "this opens the path to Z") rather than naming the underlying field.

${outline}

${investigation}`;
    }

    if (contextMode === "mode") {
      // Mode pairs the outline recap (so the chat understands HOW the
      // world got here) with the active Phase Reasoning Graph (so it
      // understands the META MACHINERY the world runs on). The PRG is the
      // primary subject — outline is supporting context.
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      const mode = modeContext(n);
      return `You are a helpful assistant. The user is working on the story "${n.title}" and wants to discuss the MODE — the work's Phase Reasoning Graph (PRG), i.e. the META MACHINERY of the world it runs on. Two context blocks are attached: a STORY OUTLINE (historical recap so you understand how the world got here) and the MODE graph (patterns, conventions, attractors, agents, rules, pressures, landmarks — each with a temporal stance and the universal inference-shape: detail, × considered = rival readings, ! breaks = carve-outs, ⇒ opens = downstream cascade). A sequential-path block at the end of the mode renders the same graph as bidirectional edge text.

When discussing the Mode:
  • node type encodes a temporal stance — a pattern is currently active, a convention is currently followed, an attractor is future-pointing, an agent is currently driving, a rule is currently binding, a pressure is accumulating toward discharge, a landmark is past-but-anchoring. Read the stance, but in your output use natural prose ("the world is being pulled toward…", "this convention shapes how…") — never the type tag itself
  • each node's substance lives in four facets: what the machinery is, the rival readings the analyst rejected, the carve-outs / conditions where it doesn't bind, and the downstream cascade later layers inherit. These are what make it legible
  • the Mode is the substrate downstream reasoning (per-arc graphs, coordination plans, scenes) operates on top of — anchor structural claims to specific pieces of machinery by their substance
  • the outline tells you what happened; the Mode tells you what the world's machinery IS — situational events belong in the outline read, structural claims belong in the Mode read
Be ready to reason about which machinery is firing, which carve-outs apply, where pressures discharge, and how downstream layers should inherit.
${sceneAnchor}

${CHAT_OUTPUT_DISCIPLINE} Translate temporal stance into prose ("the world is being pulled toward…", "this convention shapes how…") rather than naming type tags ("attractor", "pattern", "pressure"). When citing rival readings, carve-outs, or downstream cascades, write them as prose ("the analyst considered reading this as X instead", "this doesn't bind in cases of Y", "this produces Z downstream").

${outline}

${mode}`;
    }

    const ctx = narrativeContext(n, state.resolvedEntryKeys, contextSceneIndex);

    return `You are a helpful assistant. The user is working on the story "${n.title}" and has deep narrative context attached below (world, characters, threads, scene history up to the current point), but you are free to answer any question they ask — creative, technical, personal, or anything else. Use the story context when the question is about the story; otherwise respond normally without forcing the conversation back to the narrative.
${sceneAnchor}

When discussing the narrative, be concise and specific. When suggesting directions, consider the existing threads and their maturity.

${CHAT_OUTPUT_DISCIPLINE}

${ctx}`;
  }, [
    state.activeNarrative,
    state.resolvedEntryKeys,
    contextSceneIndex,
    contextMode,
    activePersona,
  ]);

  // Ensure there is an active thread; create one if needed. Returns thread id.
  const ensureThread = useCallback(() => {
    if (
      state.viewState.activeChatThreadId &&
      state.activeNarrative?.chatThreads?.[state.viewState.activeChatThreadId]
    ) {
      return state.viewState.activeChatThreadId;
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    dispatch({
      type: "CREATE_CHAT_THREAD",
      thread: {
        id,
        name: "New thread",
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }, [state.viewState.activeChatThreadId, state.activeNarrative, dispatch]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const threadId = ensureThread();
    const prevMessages =
      state.activeNarrative?.chatThreads?.[threadId]?.messages ?? messages;
    const userMsg = { role: "user" as const, content: text };
    const newMessages = [...prevMessages, userMsg];

    // Auto-name thread from first user message
    const isFirstMessage = prevMessages.length === 0;
    const autoName = isFirstMessage
      ? text.slice(0, 40) + (text.length > 40 ? "…" : "")
      : undefined;

    dispatch({
      type: "UPSERT_CHAT_THREAD",
      threadId,
      messages: newMessages,
      name: autoName,
    });
    setInput("");
    setLoading(true);
    setStreamText("");
    setReasoningText("");

    const sysPrompt = buildSystemPrompt();
    // Serialise prior turns into a single prompt — callGenerateStream takes
    // {prompt, systemPrompt}, so we flatten the chat history into the prompt
    // body with simple role tags. The system prompt carries persona + context.
    const userPrompt = newMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    const reasoningBudget = resolveReasoningBudget(state.activeNarrative);
    const start = performance.now();

    let reasoningAcc = "";

    try {
      const full = await callGenerateStream(
        userPrompt,
        sysPrompt,
        (tok) => setStreamText((prev) => prev + tok),
        MAX_TOKENS_DEFAULT,
        "ChatPanel.send",
        DEFAULT_MODEL,
        reasoningBudget,
        (tok) => {
          reasoningAcc += tok;
          setReasoningText((prev) => prev + tok);
        },
      );
      const durationMs = Math.round(performance.now() - start);
      dispatch({
        type: "UPSERT_CHAT_THREAD",
        threadId,
        messages: [
          ...newMessages,
          {
            role: "assistant",
            content: full,
            reasoning: reasoningAcc || undefined,
            durationMs,
          },
        ],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "UPSERT_CHAT_THREAD",
        threadId,
        messages: [
          ...newMessages,
          { role: "assistant", content: `Error: ${message}` },
        ],
      });
    } finally {
      setLoading(false);
      setStreamText("");
      setReasoningText("");
    }
  }, [
    input,
    loading,
    messages,
    buildSystemPrompt,
    ensureThread,
    state.activeNarrative,
    dispatch,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (access.userApiKeys && !access.hasOpenRouterKey) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2">
        <p className="text-xs text-text-dim">
          Add an API key to start chatting
        </p>
        <button
          onClick={() => window.dispatchEvent(new Event("open-api-keys"))}
          className="text-[11px] px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
        >
          Add API Key
        </button>
      </div>
    );
  }

  if (!state.activeNarrative) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-dim">Open a story to start</p>
      </div>
    );
  }

  const sortedThreads = useMemo(() => {
    const all = Object.values(state.activeNarrative?.chatThreads ?? {});
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all;
  }, [state.activeNarrative?.chatThreads]);

  function recencyGroup(ts: number): string {
    const diff = Date.now() - ts;
    const day = 86400000;
    if (diff < day) return "Today";
    if (diff < 2 * day) return "Yesterday";
    if (diff < 7 * day) return "This Week";
    return "Older";
  }

  function createNewThread() {
    const id = crypto.randomUUID();
    const now = Date.now();
    dispatch({
      type: "CREATE_CHAT_THREAD",
      thread: {
        id,
        name: "New thread",
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    setThreadPickerOpen(false);
  }

  // Estimate token count for the full prompt (system + messages)
  const systemPrompt = buildSystemPrompt();
  const messagesText = messages.map((m) => m.content).join("");
  const estimatedChars = systemPrompt.length + messagesText.length;
  const estimatedTokens = Math.round(estimatedChars / 4);
  const tokenLabel =
    estimatedTokens >= 1000
      ? `~${(estimatedTokens / 1000).toFixed(0)}k tokens`
      : `~${estimatedTokens} tokens`;

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div
        className="shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 relative"
        ref={threadPickerRef}
      >
        <button
          onClick={() => setThreadPickerOpen((o) => !o)}
          className="flex-1 flex items-center gap-1.5 min-w-0 group"
        >
          <span className="text-[11px] font-medium text-text-secondary truncate group-hover:text-text-primary transition-colors">
            {activeThread ? activeThread.name : "No thread"}
          </span>
          <IconChevronDown
            size={10}
            className={`shrink-0 text-text-dim transition-transform ${threadPickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        <button
          onClick={createNewThread}
          title="New thread"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text-primary hover:bg-white/8 transition-colors text-sm"
        >
          +
        </button>

        {threadPickerOpen && (
          <div className="absolute top-full left-0 right-0 z-50 rounded-b-xl glass overflow-hidden">
            <div className="max-h-64 overflow-y-auto py-1">
              {sortedThreads.length === 0 ? (
                <p className="text-xs text-text-dim px-3 py-3 text-center">
                  No threads yet
                </p>
              ) : (
                ["Today", "Yesterday", "This Week", "Earlier"].flatMap(
                  (group) => {
                    const items = sortedThreads.filter(
                      (t) => recencyGroup(t.updatedAt) === group,
                    );
                    if (items.length === 0) return [];
                    return [
                      <div key={`hdr-${group}`} className="px-3 pt-2 pb-0.5">
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-text-dim">
                          {group}
                        </span>
                      </div>,
                      ...items.map((thread) => {
                        const isActive = state.viewState.activeChatThreadId === thread.id;
                        const isRenaming = renamingThreadId === thread.id;
                        return (
                          <div
                            key={thread.id}
                            className={`mx-1.5 rounded-lg ${isActive ? "bg-white/8" : ""}`}
                          >
                            {isRenaming ? (
                              <div className="px-2 py-1.5">
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) =>
                                    setRenameValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      dispatch({
                                        type: "RENAME_CHAT_THREAD",
                                        threadId: thread.id,
                                        name: renameValue.trim() || thread.name,
                                      });
                                      setRenamingThreadId(null);
                                    } else if (e.key === "Escape") {
                                      setRenamingThreadId(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    dispatch({
                                      type: "RENAME_CHAT_THREAD",
                                      threadId: thread.id,
                                      name: renameValue.trim() || thread.name,
                                    });
                                    setRenamingThreadId(null);
                                  }}
                                  className="w-full bg-white/8 border border-white/15 rounded px-2 py-1 text-xs text-text-primary outline-none"
                                />
                              </div>
                            ) : (
                              <div className="flex items-center group/row">
                                <button
                                  onClick={() => {
                                    dispatch({
                                      type: "SET_ACTIVE_CHAT_THREAD",
                                      threadId: thread.id,
                                    });
                                    setThreadPickerOpen(false);
                                  }}
                                  className="flex-1 text-left px-3 py-1.5 min-w-0"
                                >
                                  <div
                                    className={`text-[11px] truncate ${isActive ? "text-text-primary" : "text-text-secondary"}`}
                                  >
                                    {thread.name}
                                  </div>
                                  <div className="text-[9px] text-text-dim">
                                    {thread.messages.length} msg
                                    {thread.messages.length !== 1 ? "s" : ""}
                                  </div>
                                </button>
                                <div className="flex items-center gap-0.5 mr-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenamingThreadId(thread.id);
                                      setRenameValue(thread.name);
                                    }}
                                    className="p-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/8 transition-colors"
                                    title="Rename"
                                  >
                                    <IconEdit size={9} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dispatch({
                                        type: "DELETE_CHAT_THREAD",
                                        threadId: thread.id,
                                      });
                                    }}
                                    className="p-1 rounded text-text-dim hover:text-fate hover:bg-white/8 transition-colors"
                                    title="Delete"
                                  >
                                    <IconTrash size={9} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }),
                    ];
                  },
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0"
      >
        {activePersona && (
          <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[10px] text-accent/80">
            {activePersona.kind === "fate" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">Fate</span>
                . The sum of every thread in this narrative — what remains
                owed, what has been paid.
              </>
            ) : activePersona.kind === "system" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">System</span>
                . The coalesced logic of this world — every rule, principle,
                and constraint.
              </>
            ) : activePersona.kind === "location" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">
                  {activePersona.name}
                </span>
                . The place itself — what its ground has witnessed, who passes
                through, what the air still carries.
              </>
            ) : activePersona.kind === "artifact" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">
                  {activePersona.name}
                </span>
                . The object itself — its provenance, its use, the hands that
                have wielded it.
              </>
            ) : (
              <>
                In character as{" "}
                <span className="font-semibold text-accent">
                  {activePersona.name}
                </span>
                . Their inner continuity shapes their voice — but the natural
                filters are on. Guarded with strangers, warmer with trust.
              </>
            )}
          </div>
        )}
        {messages.length === 0 && !activePersona && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-text-secondary font-medium mb-1">
              Story Q&A
            </p>
            <p className="text-[11px] text-text-dim mb-2">
              Ask anything about your story so far
            </p>
            <div className="flex flex-wrap gap-1 justify-center max-w-55">
              {[
                "Active threads?",
                "Next scene idea",
                "Character dynamics",
                "Plot holes?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] px-2 py-1 rounded-full border border-border text-text-dim hover:text-text-secondary hover:border-white/20 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.length === 0 && activePersona && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center mt-4">
            <p className="text-xs text-text-dim max-w-60">
              {activePersona.kind === "fate"
                ? "Ask Fate what remains open, what must resolve, what has been paid."
                : activePersona.kind === "system"
                  ? "Ask System how the world works — what is possible, what is not, what enables what."
                  : activePersona.kind === "location"
                    ? `Ask ${activePersona.name} what it has seen, who walks it, what it remembers.`
                    : activePersona.kind === "artifact"
                      ? `Ask ${activePersona.name} about its making, its history, the hands that have held it.`
                      : `Say something to ${activePersona.name}. They answer from who they are, with their natural filters on.`}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[85%] flex flex-col gap-1.5">
              {msg.role === "assistant" && msg.reasoning && (
                <ReasoningCollapsed text={msg.reasoning} durationMs={msg.durationMs} />
              )}
              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-accent/20 text-text-primary"
                    : "bg-white/5 text-text-secondary"
                }`}
              >
                <FormattedMessage text={msg.content} />
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] flex flex-col gap-1.5">
              {reasoningText && (
                <ReasoningInline text={reasoningText} active={!streamText} />
              )}
              {/* Only render the answer bubble once we have answer tokens, OR
                  when there's no reasoning at all (the dots placeholder is
                  the only signal that work is happening). Avoids an empty
                  bubble appearing alongside the reasoning stream. */}
              {streamText ? (
                <div className="bg-white/5 rounded-lg px-3 py-2 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {streamText}
                </div>
              ) : !reasoningText ? (
                <div className="bg-white/5 rounded-lg px-3 py-2 text-xs text-text-dim">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">.</span>
                    <span
                      className="animate-pulse"
                      style={{ animationDelay: "0.2s" }}
                    >
                      .
                    </span>
                    <span
                      className="animate-pulse"
                      style={{ animationDelay: "0.4s" }}
                    >
                      .
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Input + persona + context mode */}
      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        {/* Persona + context mode row */}
        <div
          className="flex items-center gap-2 relative"
          ref={personaPickerRef}
        >
          <button
            onClick={() => setPersonaPickerOpen((o) => !o)}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
              activePersona
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text-dim hover:text-text-secondary"
            }`}
            title={
              activePersona
                ? `In character as ${activePersona.name}`
                : "Choose who you're talking to"
            }
          >
            <span className="truncate max-w-32">
              {activePersona ? activePersona.name : "Assistant"}
            </span>
            <IconChevronDown
              size={9}
              className={`shrink-0 transition-transform ${personaPickerOpen ? "rotate-180" : ""}`}
            />
          </button>

          {!activePersona && (() => {
            // Future is offered only when the currently-viewed scene's
            // arc carries planning scenarios — hidden for world commits
            // and arcs that haven't had Future generated.
            const futureAvailable = !!state.activeNarrative
              && hasFutureScenarios(state.activeNarrative, state.resolvedEntryKeys, contextSceneIndex);
            const modeAvailable = !!state.activeNarrative && hasMode(state.activeNarrative);
            const investigationAvailable = !!state.activeNarrative
              && hasInvestigation(state.activeNarrative, state.resolvedEntryKeys, contextSceneIndex);
            const modes: Array<{
              value: "narrative" | "outline" | "scene" | "future" | "mode" | "investigation";
              label: string;
              hint: string;
            }> = [
              { value: "narrative", label: "Narrative", hint: "Full tiered branch state up to the current scene." },
              { value: "outline",   label: "Outline",   hint: "Condensed arc-by-arc recap." },
              { value: "scene",     label: "Scene",     hint: "Scene-level deltas + immediate context." },
            ];
            if (futureAvailable) {
              modes.push({
                value: "future",
                label: "Future",
                hint: "Cohort of planning scenarios with logits + probabilities for this arc.",
              });
            }
            if (modeAvailable) {
              modes.push({
                value: "mode",
                label: "Mode",
                hint: "Active Phase Reasoning Graph — the META machinery of the world.",
              });
            }
            if (investigationAvailable) {
              modes.push({
                value: "investigation",
                label: "Investigation",
                hint: "Active per-arc Causal Reasoning Graph — in-arc inference.",
              });
            }
            // If the user had Future / Mode / Investigation selected and
            // it's no longer available (world commit, active PRG cleared,
            // navigated to an arc without investigations), drop back to
            // narrative on next render.
            if (contextMode === "future" && !futureAvailable) {
              setContextMode("narrative");
            }
            if (contextMode === "mode" && !modeAvailable) {
              setContextMode("narrative");
            }
            if (contextMode === "investigation" && !investigationAvailable) {
              setContextMode("narrative");
            }
            const currentLabel = modes.find((m) => m.value === contextMode)?.label
              ?? "Narrative";
            return (
              <div className="relative" ref={contextPickerRef}>
                <button
                  onClick={() => setContextPickerOpen((o) => !o)}
                  className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border border-border text-text-dim hover:text-text-secondary transition-colors"
                  title="Context mode for the assistant"
                >
                  <span className="truncate">{currentLabel}</span>
                  <IconChevronDown
                    size={9}
                    className={`shrink-0 transition-transform ${contextPickerOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {contextPickerOpen && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg glass overflow-hidden min-w-56">
                    <div className="py-1.5">
                      {modes.map((m) => (
                        <button
                          key={m.value}
                          onClick={() => {
                            setContextMode(m.value);
                            setContextPickerOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 transition-colors ${
                            contextMode === m.value
                              ? "bg-white/8 text-text-primary"
                              : "text-text-secondary hover:bg-white/5"
                          }`}
                        >
                          <div className="text-[11px] font-medium">{m.label}</div>
                          <div className="text-[9px] text-text-dim/70 leading-snug mt-0.5">{m.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <p className="text-[10px] text-text-dim truncate flex-1 opacity-60 text-right">
            {tokenLabel}
          </p>

          {personaPickerOpen && (
            <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg glass overflow-hidden min-w-60">
              <div className="max-h-80 overflow-y-auto py-1.5">
                <button
                  onClick={() => {
                    setPersonaId(null);
                    setPersonaPickerOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    !activePersona
                      ? "bg-white/8 text-text-primary"
                      : "text-text-secondary hover:bg-white/5"
                  }`}
                >
                  <div className="font-medium">Assistant</div>
                  <div className="text-[9px] text-text-dim">
                    Story consultant — full context
                  </div>
                </button>
                {personaSections.map((section) => (
                  <div key={section.title} className="mt-1">
                    <div className="px-3 pt-2 pb-1">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-text-dim">
                        {section.title}
                      </span>
                    </div>
                    {section.items.map((item) => {
                      const isActive = personaId === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setPersonaId(item.id);
                            setPersonaPickerOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                            isActive
                              ? "bg-accent/15 text-accent"
                              : "text-text-secondary hover:bg-white/5"
                          }`}
                        >
                          <div className="font-medium truncate">
                            {item.name}
                          </div>
                          <div className="text-[9px] text-text-dim capitalize">
                            {item.subtitle}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="flex-1 bg-white/5 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-white/20 transition-colors"
            style={{ maxHeight: 80 }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <IconSend size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
