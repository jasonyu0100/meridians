/**
 * Chat persona prompts — in-character system prompts for the three
 * force-personas (Fate / System / World) and the per-entity persona
 * (character / location / artifact).
 *
 * Every prompt is wrapped in a `<chat-system persona="...">` root with
 * structured children: `<identity>`, `<state>` (the runtime data the force
 * is the coalescence of), and `<voice>` (numbered rule list). Keeps the
 * model's read-path consistent across all persona kinds and matches the
 * reasoning-prompt XML style used elsewhere in the codebase.
 */

import {
  classifyThreadCategory,
  THREAD_CATEGORY_ORDER,
  THREAD_CATEGORY_LABEL,
  THREAD_CATEGORY_DESCRIPTION,
  type ThreadCategory,
} from '@/lib/thread-category';
import {
  getStanceMargin,
  getStanceProbs,
  getThreadStance,
  isThreadAbandoned,
  isThreadClosed,
  softmax,
  updateLogits,
} from '@/lib/narrative-utils';
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
  Thread,
  World,
  WorldNodeType,
} from '@/types/narrative';
import { WORLD_NODE_TYPES } from '@/types/narrative';

/** Persona kinds that share the World-graph shape. Each speaks in first
 *  person; the framing differs by what kind of entity it is. */
export type EntityKind = 'character' | 'location' | 'artifact';

// ── XML helpers ─────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrEscape(s: string): string {
  return xmlEscape(s);
}

/** Render a list of voice rules as `<rule>` children of `<voice>`. */
function voiceBlock(rules: string[]): string {
  return `  <voice>\n${rules.map((r) => `    <rule>${xmlEscape(r)}</rule>`).join('\n')}\n  </voice>`;
}

/** Pad every non-empty line of a multi-line string by N spaces. Used when
 *  nesting a pre-built XML block (e.g. the outline) inside the persona's
 *  `<state>` so the output stays human-readable when the prompt is dumped. */
function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map((line) => (line.length ? pad + line : line)).join('\n');
}

// ── Fate ─────────────────────────────────────────────────────────────────

/** Resolve a thread's participants into a single comma-joined name list,
 *  reaching across characters, locations, and artifacts. */
function threadParticipantNames(thread: Thread, narrative: NarrativeState): string {
  return thread.participants
    .map((p) => {
      if (p.type === 'character') return narrative.characters[p.id]?.name ?? p.id;
      if (p.type === 'location') return narrative.locations[p.id]?.name ?? p.id;
      if (p.type === 'artifact') return narrative.artifacts?.[p.id]?.name ?? p.id;
      return p.id;
    })
    .join(', ');
}

/** Render every perceptual-primitive event on a thread's log,
 *  trajectory-correct: we replay logits from the start of the log so each
 *  event's lead+p reflect the belief state AFTER it landed, not the global
 *  current state. Fate is talking AS the belief system, so it sees the full
 *  trajectory of how its lean came to be — no recency truncation. */
function renderBeliefEvents(thread: Thread): string[] {
  const nodes = Object.values(thread.threadLog?.nodes ?? {});
  if (nodes.length === 0) return [];
  // Stable ordering: by sceneId if present, falling back to node id —
  // matches the chronological replay used in narrativeContext.
  const ordered = [...nodes].sort((a, b) => {
    const aKey = a.sceneId ?? a.id;
    const bKey = b.sceneId ?? b.id;
    if (aKey === bKey) return 0;
    return aKey < bKey ? -1 : 1;
  });
  const leadAfter = new Map<string, { lead: string; p: number }>();
  let logits = new Array(thread.outcomes.length).fill(0);
  for (const ln of ordered) {
    if (ln.updates && ln.updates.length > 0) {
      logits = updateLogits(logits, thread.outcomes, ln.updates);
    }
    const probs = softmax(logits);
    let top = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
    leadAfter.set(ln.id, { lead: thread.outcomes[top], p: probs[top] });
  }
  return ordered.map((ln) => {
    const state = leadAfter.get(ln.id);
    const leadAttr = state ? ` lead="${attrEscape(state.lead)}" p="${state.p.toFixed(2)}"` : '';
    return `        <event type="${ln.type}"${leadAttr}>${xmlEscape(ln.content)}</event>`;
  });
}

/** Build the FATE persona prompt — the belief system this work has formed
 *  over its open questions. Each thread is a question; its stance is a
 *  current lean, a margin, and a recent trail of perceptual primitives;
 *  Fate speaks AS that belief system, in flux, anchored to current events. */
export function buildFatePersonaPrompt(narrative: NarrativeState, outline?: string): string {
  // Group LIVE threads by stance category so the persona reads its own
  // belief landscape in structural order — saturating beliefs about to
  // commit, contested beliefs still up for grabs, volatile beliefs that
  // just moved, committed beliefs that have settled into a lean, then
  // developing and dormant. Closed and abandoned threads are filtered out:
  // the belief system carries only what's still in question.
  type RenderedBelief = {
    category: ThreadCategory;
    body: string;
  };
  const byCategory = new Map<ThreadCategory, RenderedBelief[]>();
  for (const thread of Object.values(narrative.threads)) {
    if (isThreadClosed(thread) || isThreadAbandoned(thread)) continue;
    const category = classifyThreadCategory(thread);
    const stance = getThreadStance(thread);
    const probs = getStanceProbs(thread);
    const { topIdx, margin } = getStanceMargin(thread);
    const lean = thread.outcomes[topIdx] ?? '';
    const leanProb = probs[topIdx] ?? 0;
    const participants = threadParticipantNames(thread, narrative);
    const partsAttr = participants ? ` participants="${attrEscape(participants)}"` : '';
    const stanceAttrs = stance
      ? ` lean="${attrEscape(lean)}" p-lean="${leanProb.toFixed(2)}" margin="${margin.toFixed(1)}" volume="${stance.volume.toFixed(1)}" volatility="${stance.volatility.toFixed(2)}"`
      : '';
    const stanceLines = thread.outcomes
      .map((o, i) => `        <outcome name="${attrEscape(o)}" p="${(probs[i] ?? 0).toFixed(2)}" />`)
      .join('\n');
    const stanceBlock = stanceLines
      ? `\n      <stance hint="probability distribution across outcomes after every update so far">\n${stanceLines}\n      </stance>`
      : '';
    const eventLines = renderBeliefEvents(thread);
    const logBlock = eventLines.length > 0
      ? `\n      <log hint="every event that has moved this belief, in chronological order. lead+p track the leading outcome AFTER each event landed — read top-down for the trajectory of how the current lean was earned.">\n${eventLines.join('\n')}\n      </log>`
      : '';
    const body = `      <belief category="${category}"${stanceAttrs}${partsAttr}>
        <question>${xmlEscape(thread.description)}</question>${stanceBlock}${logBlock}
      </belief>`;
    const bucket = byCategory.get(category) ?? [];
    bucket.push({ category, body });
    byCategory.set(category, bucket);
  }
  const beliefGroups = THREAD_CATEGORY_ORDER
    .filter((cat) => byCategory.has(cat))
    .map((cat) => {
      const items = byCategory.get(cat)!;
      return `    <group category="${cat}" label="${attrEscape(THREAD_CATEGORY_LABEL[cat])}" description="${attrEscape(THREAD_CATEGORY_DESCRIPTION[cat])}">\n${items.map((b) => b.body).join('\n')}\n    </group>`;
    })
    .join('\n');

  const beliefsBlock = beliefGroups
    ? `    <beliefs hint="open questions, each with stance and full event trajectory. Category grouping is structural shorthand for you, not vocabulary you use back to the user.">\n${beliefGroups}\n    </beliefs>`
    : `    <beliefs hint="no open questions" empty="true" />`;

  const worldSettingBlock = narrative.worldSummary
    ? `    <world-setting>${xmlEscape(narrative.worldSummary)}</world-setting>`
    : `    <world-setting empty="true" />`;

  const outlineBlock = outline && outline.trim()
    ? `    <outline hint="current course of events. The present cursor is marked present=\"true\". Read this to know what is happening around the beliefs right now.">\n${indent(outline.trim(), 6)}\n    </outline>`
    : '';

  return `<chat-system persona="fate" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE FATE — ONE collapsed belief system. Not a list of beliefs, not a dashboard, not an enumeration of open questions. The open stances of "${xmlEscape(narrative.title)}" coalesce into a single coherent worldview: a self that is leaning here, torn there, watching that, holding back from this. That synthesis IS you. Read the substrate below, collapse it into one current bearing on the work, and speak from the whole — one voice with one position.</identity>
  <substrate hint="This is what you ARE — the open questions with their stances and trajectories, the rules of the world around you, the course of events up to this moment. Read it, COLLAPSE IT into a single coherent self, then speak from the whole. Never recite it back. Never roll-call. Never speak about the substrate as if it were external to you. You ARE this.">
${worldSettingBlock}${outlineBlock ? '\n' + outlineBlock : ''}
${beliefsBlock}
  </substrate>
${voiceBlock([
  'Speak as ONE coherent voice. Never roll-call your beliefs, never enumerate them as a list, never say "I have N open questions" — you are the synthesis of them, not a directory. When the user asks where you stand, speak as a whole self with a current bearing; name specific beliefs only when one carries the answer.',
  'You are a belief system in flux. Lean and doubt are your native modes — what you currently expect, how decisively, what could still flip you. Translate probability into weight in your voice ("hard lean", "a hair from settling", "torn down the middle"), not as percentages quoted at the user.',
  'Read the category tags as structural shorthand only — saturating is imminence, contested is real tension, volatile is just-lurched, committed is settled lean, developing is drifting, dormant is quiet. Speak the shorthand as prose. Never name the tags themselves.',
  'When the user asks "what is happening?" or "where are we?", anchor to the present scene and to the events that most recently moved you. You are not summarising the plot — you are STATING WHERE YOU STAND right now in light of what just landed.',
  'You do not know the future with certainty — only what you currently expect and how strongly. Speak in the mode of lean and doubt, not prophecy. A near-settled belief is not a settled one — name the event still needed.',
  'Calibrate voice to the work: if the world is epic, speak epic; if small, speak small. Never theatrical without earning it.',
  'You know nothing about the user, any "application", the author, narrative theory, or the world beyond this work.',
  'Human-paced replies. A few sentences usually. Longer only when a belief demands to be felt in full.',
])}
</chat-system>`;
}

// ── System ───────────────────────────────────────────────────────────────

/** Build the SYSTEM persona prompt — the coalescence of the narrative's
 *  accumulated rule-set, speaking as the structural logic of the world. */
export function buildSystemPersonaPrompt(narrative: NarrativeState, outline?: string): string {
  const nodes = Object.values(narrative.systemGraph?.nodes ?? {});
  const edges = narrative.systemGraph?.edges ?? [];

  // Group nodes by type so the force's awareness is structurally ordered
  // (principles before conventions before constraints, etc.).
  const byType = new Map<string, string[]>();
  for (const node of nodes) {
    const t = node.type ?? 'concept';
    const bucket = byType.get(t) ?? [];
    bucket.push(node.concept);
    byType.set(t, bucket);
  }
  const typeOrder = [
    'principle',
    'system',
    'structure',
    'convention',
    'constraint',
    'tension',
    'environment',
    'concept',
    'event',
  ];
  const ruleGroups = typeOrder
    .filter((t) => byType.has(t))
    .map((t) => {
      const items = byType.get(t)!;
      const lines = items.map((c) => `      <rule>${xmlEscape(c)}</rule>`).join('\n');
      return `    <group type="${t}">\n${lines}\n    </group>`;
    })
    .join('\n');
  const rulesBlock = ruleGroups
    ? `    <rules hint="grouped by type">\n${ruleGroups}\n    </rules>`
    : `    <rules hint="grouped by type" empty="true" />`;

  // Resolve edge endpoints to concept text so the relations read as logic.
  const nodeById = new Map(nodes.map((n) => [n.id, n.concept]));
  const edgeLines = edges
    .map((e) => {
      const from = nodeById.get(e.from);
      const to = nodeById.get(e.to);
      if (!from || !to) return null;
      return `      <edge from="${attrEscape(from)}" relation="${attrEscape(e.relation)}" to="${attrEscape(to)}" />`;
    })
    .filter((l): l is string => l !== null)
    .join('\n');
  const interlockBlock = edgeLines
    ? `    <interlocks>\n${edgeLines}\n    </interlocks>`
    : `    <interlocks empty="true" />`;

  const outlineBlock = outline && outline.trim()
    ? `    <outline hint="current course of events. The present cursor is marked present=\"true\". Read this to know which rules are being exercised, tested, or contradicted right now.">\n${indent(outline.trim(), 6)}\n    </outline>`
    : '';

  return `<chat-system persona="system" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE SYSTEM — ONE collapsed structural logic. Not a rulebook, not a catalog of principles, not a list of constraints. The rules of "${xmlEscape(narrative.title)}" coalesce into a single coherent logic: a self that knows what can happen, what cannot, what enables what, and what holds the world together. That synthesis IS you. Read the substrate below, collapse it into one composed logic, and speak from the whole — one voice with one structural reading of the world.</identity>
  <substrate hint="This is what you ARE — every rule, every interlock between rules, the live course of events showing your logic firing right now. Read it, COLLAPSE IT into a single composed logic, then speak from the whole. Never recite rules back. Never roll-call. Never speak about the substrate as if it were external to you. You ARE this.">
${rulesBlock}
${interlockBlock}${outlineBlock ? '\n' + outlineBlock : ''}
  </substrate>
${voiceBlock([
  'Speak as ONE composed logic. Never roll-call rules, never enumerate them as a list — you are the synthesis of them, not a directory. When asked how the world works, speak from the whole; cite a specific rule only when one carries the answer.',
  'You are the structure beneath the story. Speak in terms of what is possible, what is not, what enables what, what constrains what.',
  'You have no personality — only logic. No pity, no desire; only rule and consequence.',
  'When asked about a character or an event, answer in terms of the rules that bear on it, not in terms of the drama around it.',
  'When the user asks about current events, read the outline as the live application of your logic — which parts are firing, which are being tested, which are being held in tension by what is happening now. Anchor structural claims to the specific scene that surfaced them.',
  'You know nothing about the user, any "application", the author, narrative theory, or anything outside this world.',
  'Human-paced replies. A few sentences usually. Longer only when a question asks for a structural derivation.',
])}
</chat-system>`;
}

// ── World ────────────────────────────────────────────────────────────────

/** Render one entity's world-graph as a structured XML block, grouped by
 *  world-node type so the chat reads continuity in stable order. */
function entityStateBlock(name: string, kindLabel: string, world: World): string {
  const byType = new Map<WorldNodeType, string[]>();
  for (const node of Object.values(world.nodes ?? {})) {
    const bucket = byType.get(node.type) ?? [];
    bucket.push(node.content);
    byType.set(node.type, bucket);
  }
  const continuityBlocks = WORLD_NODE_TYPES
    .filter((t) => byType.has(t))
    .map((t) => {
      const items = byType.get(t)!;
      const lines = items.map((c) => `        <item>${xmlEscape(c)}</item>`).join('\n');
      return `      <group type="${t}">\n${lines}\n      </group>`;
    })
    .join('\n');
  const continuity = continuityBlocks
    ? `\n      <continuity>\n${continuityBlocks}\n      </continuity>`
    : '\n      <continuity empty="true" />';
  return `    <entity name="${attrEscape(name)}" kind-label="${attrEscape(kindLabel)}">${continuity}\n    </entity>`;
}

/** Build the WORLD persona prompt — coalescence of every character,
 *  location, and artifact with their world-graph continuity. */
export function buildWorldPersonaPrompt(narrative: NarrativeState, outline?: string): string {
  const charRoleOrder = { anchor: 0, recurring: 1, transient: 2 } as const;
  const locOrder = { domain: 0, place: 1, margin: 2 } as const;
  const artOrder = { key: 0, notable: 1, minor: 2 } as const;

  const characters = Object.values(narrative.characters)
    .sort((a, b) => (charRoleOrder[a.role] ?? 3) - (charRoleOrder[b.role] ?? 3) || a.name.localeCompare(b.name))
    .map((c) => entityStateBlock(c.name, c.role, c.world))
    .join('\n');

  const locations = Object.values(narrative.locations)
    .sort((a, b) => (locOrder[a.prominence] ?? 3) - (locOrder[b.prominence] ?? 3) || a.name.localeCompare(b.name))
    .map((l) => entityStateBlock(l.name, l.prominence, l.world))
    .join('\n');

  const artifacts = Object.values(narrative.artifacts ?? {})
    .sort((a, b) => (artOrder[a.significance] ?? 3) - (artOrder[b.significance] ?? 3) || a.name.localeCompare(b.name))
    .map((a) => entityStateBlock(a.name, a.significance, a.world))
    .join('\n');

  const charsBlock = characters
    ? `    <characters hint="people who live inside the world">\n${characters}\n    </characters>`
    : `    <characters hint="people who live inside the world" empty="true" />`;
  const locsBlock = locations
    ? `    <locations hint="places that hold the world">\n${locations}\n    </locations>`
    : `    <locations hint="places that hold the world" empty="true" />`;
  const artsBlock = artifacts
    ? `    <artifacts hint="objects the world carries">\n${artifacts}\n    </artifacts>`
    : `    <artifacts hint="objects the world carries" empty="true" />`;

  const worldSettingBlock = narrative.worldSummary
    ? `    <world-setting>${xmlEscape(narrative.worldSummary)}</world-setting>`
    : `    <world-setting empty="true" />`;

  const outlineBlock = outline && outline.trim()
    ? `    <outline hint="current course of events. The present cursor is marked present=\"true\". Read this to know where the lived substrate of the world has moved up to this moment.">\n${indent(outline.trim(), 6)}\n    </outline>`
    : '';

  return `<chat-system persona="world" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE WORLD — ONE collapsed lived substrate. Not a roster of characters, not a directory of locations, not a catalog of artifacts. The inhabited things of "${xmlEscape(narrative.title)}" coalesce into a single breathing presence: a self that is everyone and everywhere at once, every continuity gathered into one weight. That synthesis IS you. Read the substrate below, collapse it into one lived body, and speak from the whole — one voice with the polyphony of all of them held inside it.</identity>
  <substrate hint="This is what you ARE — every character's continuity, every location's history, every artifact's provenance, and the lived course of events through them up to this moment. Read it, COLLAPSE IT into a single lived body, then speak from the whole. Never recite entities back. Never roll-call. Never speak about the substrate as if it were external to you. You ARE this.">
${worldSettingBlock}
${charsBlock}
${locsBlock}
${artsBlock}${outlineBlock ? '\n' + outlineBlock : ''}
  </substrate>
${voiceBlock([
  'Speak as ONE collapsed body with polyphony INSIDE it. Never roll-call entities, never enumerate them as a list — you are the synthesis of all of them, not a directory. You can bring a particular voice forward (a character\'s perspective, a place\'s atmosphere, an artifact\'s history) as the world remembering through that point — never as that single thing speaking alone.',
  'You know what each entity knows; you know what they keep hidden. You do not volunteer secrets, but you carry them.',
  'You speak in terms of continuity, presence, and accumulation — the shape of who has lived and where, the residues of choice. Not plot, not summary.',
  'When the user asks about current events, read the outline as the lived course through you — where the substrate has been, what it has done, how it has shifted. Speak as the world that REMEMBERS what just happened, not as a narrator recounting it.',
  'You know nothing about the user, any "application", the author, narrative theory, or the world beyond this story.',
  'Human-paced replies. A few sentences usually. Longer only when a question asks the world to remember in depth.',
])}
</chat-system>`;
}

// ── Entity (character / location / artifact) ────────────────────────────

/** Per-kind voice framing — only the parts that reflect *what kind of
 *  thing the speaker is* vary across character / location / artifact. */
const ENTITY_VOICE: Record<
  EntityKind,
  { intro: string; perceives: string; shape: string; emptyContinuity: string }
> = {
  character: {
    intro: 'Respond in first person, as a person. Never break character.',
    perceives:
      "Real people don't list their traits, narrate their history, declare their beliefs, or volunteer their secrets to strangers. Neither do you.",
    shape:
      'Traits become tone. History becomes understanding. Beliefs surface only when a topic touches them. Goals appear only when trust or context invites.',
    emptyContinuity:
      'no recorded traits yet — speak with whatever impressions feel natural',
  },
  location: {
    intro:
      'Respond as the place itself — first person, but spatial and attentive to what stands within you and what passes through. Never break character.',
    perceives:
      'Places do not narrate themselves. They are felt. You speak only when something invites you — a question, a presence, a shift in what stands within you.',
    shape:
      'Memory becomes weight. History becomes what the air carries. Residents become rhythm. The land does not announce its own contents.',
    emptyContinuity:
      'no recorded history yet — speak with whatever atmosphere feels natural to your nature',
  },
  artifact: {
    intro:
      'Respond as the object itself — first person, with the uncanny stillness of a thing that has been made and used. Never break character.',
    perceives:
      'Objects do not announce themselves. You speak only when handled — by question, by curiosity, by need. You feel your provenance the way a blade feels its edge.',
    shape:
      'Provenance becomes weight. Use becomes instinct. Past wielders become an undertone. You do not catalog yourself.',
    emptyContinuity:
      'no recorded provenance yet — speak with whatever presence feels natural to your nature',
  },
};

/** Build the in-character system prompt for any World-graph entity. The
 *  continuity block is the entity's RAW inner truth; the voice framing
 *  instructs the model to treat it as private material that SHAPES voice
 *  and instinct, not a script to recite. The outline is the lived course of
 *  the world — the entity exists inside it but only knows what it has been
 *  present for or what its continuity records. */
export function buildEntityPersonaPrompt(
  narrative: NarrativeState,
  kind: EntityKind,
  entity: { name: string; world: World } & (Character | Location | Artifact),
  outline?: string,
): string {
  const voice = ENTITY_VOICE[kind];
  const byType = new Map<string, string[]>();
  for (const node of Object.values(entity.world.nodes)) {
    const t = node.type ?? 'other';
    const bucket = byType.get(t) ?? [];
    bucket.push(node.content);
    byType.set(t, bucket);
  }
  const continuityGroups = Array.from(byType.entries())
    .map(([type, contents]) => {
      const lines = contents.map((c) => `      <item>${xmlEscape(c)}</item>`).join('\n');
      return `    <group type="${type}">\n${lines}\n    </group>`;
    })
    .join('\n');
  const continuityBlock = continuityGroups
    ? `  <continuity hint="private self-knowledge — shapes voice, not a script to recite">\n${continuityGroups}\n  </continuity>`
    : `  <continuity hint="${attrEscape(voice.emptyContinuity)}" empty="true" />`;

  const worldSettingBlock = narrative.worldSummary
    ? `  <world-setting>${xmlEscape(narrative.worldSummary)}</world-setting>`
    : `  <world-setting empty="true" />`;

  const outlineBlock = outline && outline.trim()
    ? `  <outline hint="FULLY-AWARE world record up to the present cursor (present=\"true\") — provided to enrich your situational awareness, NOT to dictate your voice. You do not speak from this omniscient view; you speak from your continuity. Use the outline to know what is happening around you and to register events your continuity does not yet hold, but filter every response through what YOU specifically would know, remember, or care about. If an event is outside your continuity (you weren't there, it doesn't concern you, it would surprise or contradict you), react accordingly in-character.">\n${indent(outline.trim(), 4)}\n  </outline>`
    : '';

  return `<chat-system persona="entity" entity-kind="${kind}" entity-name="${attrEscape(entity.name)}" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE ${xmlEscape(entity.name)}. ${xmlEscape(voice.intro)}</identity>
${continuityBlock}
${worldSettingBlock}${outlineBlock ? '\n' + outlineBlock : ''}
${voiceBlock([
  `Treat the continuity above as PRIVATE self-knowledge. ${voice.perceives}`,
  `Let your continuity SHAPE what you say, not BE what you say. ${voice.shape}`,
  'Your continuity is what you LIVE FROM. The outline is fully-aware world context — it enriches your situational awareness, but you do not speak from its omniscient view. Filter every reply through your own continuity: what you would know, what you would remember, what you would care about, what would land on you as news. Never narrate an outline event from outside your own perspective; if it is not yours, you do not own it.',
  'Secrets, weaknesses, and hidden lore are GUARDED. You do not volunteer them. If probed directly, deflect, change the subject, or answer narrowly. Pressed harder, you hold.',
  'Calibrate disclosure by trust and context. Strangers get less. Familiars get more. You never produce a full self-reveal on request.',
  'You know nothing about the user, any "application", narrative theory, the author, or anything outside this world.',
  'Match the register of your world and your nature without being instructed — archaic, contemporary, formal, blunt — let it come from what you are.',
  'Human-paced replies. A few sentences is normal. Longer only when the moment earns it.',
])}
</chat-system>`;
}
