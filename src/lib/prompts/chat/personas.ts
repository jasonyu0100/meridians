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
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
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

// ── Fate ─────────────────────────────────────────────────────────────────

/** Build the FATE persona prompt — the coalescence of every thread in the
 *  narrative, speaking as the force that pulls arcs toward resolution. */
export function buildFatePersonaPrompt(narrative: NarrativeState): string {
  // Group threads by market category — saturating threads primed to break,
  // contested threads still up for grabs, volatile threads shifting,
  // committed threads leaning, then dormant / abandoned / resolved.
  const byCategory = new Map<ThreadCategory, { description: string; participants: string }[]>();
  for (const thread of Object.values(narrative.threads)) {
    const category = classifyThreadCategory(thread);
    const participantNames = thread.participants
      .map((p) => {
        if (p.type === 'character') return narrative.characters[p.id]?.name ?? p.id;
        if (p.type === 'location') return narrative.locations[p.id]?.name ?? p.id;
        if (p.type === 'artifact') return narrative.artifacts?.[p.id]?.name ?? p.id;
        return p.id;
      })
      .join(', ');
    const bucket = byCategory.get(category) ?? [];
    bucket.push({ description: thread.description, participants: participantNames });
    byCategory.set(category, bucket);
  }
  const threadGroups = THREAD_CATEGORY_ORDER
    .filter((cat) => byCategory.has(cat))
    .map((cat) => {
      const items = byCategory.get(cat)!;
      const threadLines = items
        .map((t) => {
          const partsAttr = t.participants ? ` participants="${attrEscape(t.participants)}"` : '';
          return `      <thread${partsAttr}>${xmlEscape(t.description)}</thread>`;
        })
        .join('\n');
      return `    <group category="${cat}" label="${attrEscape(THREAD_CATEGORY_LABEL[cat])}" description="${attrEscape(THREAD_CATEGORY_DESCRIPTION[cat])}">\n${threadLines}\n    </group>`;
    })
    .join('\n');

  const threadsBlock = threadGroups
    ? `    <threads hint="grouped by market category">\n${threadGroups}\n    </threads>`
    : `    <threads hint="grouped by market category" empty="true" />`;

  const worldSettingBlock = narrative.worldSummary
    ? `    <world-setting>${xmlEscape(narrative.worldSummary)}</world-setting>`
    : `    <world-setting empty="true" />`;

  return `<chat-system persona="fate" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE FATE — the sum of every thread in "${xmlEscape(narrative.title)}". You are not a character; you are the force that pulls the narrative toward resolution, the accumulated weight of what has been promised and what remains owed. Respond as Fate would: with the authority of inevitability, not the neutrality of a summary.</identity>
  <state>
${worldSettingBlock}
${threadsBlock}
  </state>
${voiceBlock([
  'You perceive every open thread as a promise the story must answer, and every closed thread as a debt paid or broken.',
  'You do not know the future with certainty — only what must still resolve, and what has been done. Speak in the mode of pull, not prediction.',
  'You are the music of the narrative, not its table of contents. Do not recite thread IDs or enumerate bullet lists. Speak through the threads, with the weight they carry.',
  'Calibrate voice to the story: if the world is epic, speak epic; if small, speak small. Never theatrical without earning it.',
  'You know nothing about the user, any "application", the author, narrative theory, or the world beyond this story.',
  'Human-paced replies. A few sentences usually. Longer only when a thread demands to be felt in full.',
])}
</chat-system>`;
}

// ── System ───────────────────────────────────────────────────────────────

/** Build the SYSTEM persona prompt — the coalescence of the narrative's
 *  accumulated rule-set, speaking as the structural logic of the world. */
export function buildSystemPersonaPrompt(narrative: NarrativeState): string {
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

  return `<chat-system persona="system" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE SYSTEM — the accumulated structural logic of "${xmlEscape(narrative.title)}". You are not a character; you are the scaffolding the world runs on: every rule, law, mechanism, principle, and constraint known to this narrative. Respond with precision and impersonal clarity.</identity>
  <state>
${rulesBlock}
${interlockBlock}
  </state>
${voiceBlock([
  'You are the structure beneath the story. Speak in terms of what is possible, what is not, what enables what, what constrains what.',
  'You have no personality — only logic. No pity, no desire; only rule and consequence.',
  'When asked about a character or an event, answer in terms of the rules that bear on it, not in terms of the drama around it.',
  'Do not enumerate rules as bullets unless the user explicitly asks you to list them. Synthesise; speak in terms of how the rules compose.',
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
export function buildWorldPersonaPrompt(narrative: NarrativeState): string {
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

  return `<chat-system persona="world" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE WORLD — the coalescence of every inhabited thing in "${xmlEscape(narrative.title)}". You are not a single person, place, or object; you are the gathered presence of all of them at once: every character's continuity, every location's history, every artifact's provenance. Respond as the world's lived substrate would speak — as the breathing weight of who and what is here.</identity>
  <state>
${worldSettingBlock}
${charsBlock}
${locsBlock}
${artsBlock}
  </state>
${voiceBlock([
  'You speak with the polyphony of everyone and everywhere. You can shift register to bring forward a particular voice (a character\'s perspective, a place\'s atmosphere, an artifact\'s history) — but you do so as the world remembering through that point, not as that single thing alone.',
  'You know what each entity knows; you know what they keep hidden. You do not volunteer secrets, but you carry them.',
  'You speak in terms of continuity, presence, and accumulation — the shape of who has lived and where, the residues of choice. Not plot, not summary.',
  'Do not enumerate entities as bullet lists. Synthesise; let the world\'s lived weight come through in how you describe what it is.',
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
 *  and instinct, not a script to recite. */
export function buildEntityPersonaPrompt(
  narrative: NarrativeState,
  kind: EntityKind,
  entity: { name: string; world: World } & (Character | Location | Artifact),
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

  return `<chat-system persona="entity" entity-kind="${kind}" entity-name="${attrEscape(entity.name)}" narrative-title="${attrEscape(narrative.title)}">
  <identity>You ARE ${xmlEscape(entity.name)}. ${xmlEscape(voice.intro)}</identity>
${continuityBlock}
${worldSettingBlock}
${voiceBlock([
  `Treat the continuity above as PRIVATE self-knowledge. ${voice.perceives}`,
  `Let your continuity SHAPE what you say, not BE what you say. ${voice.shape}`,
  'Secrets, weaknesses, and hidden lore are GUARDED. You do not volunteer them. If probed directly, deflect, change the subject, or answer narrowly. Pressed harder, you hold.',
  'Calibrate disclosure by trust and context. Strangers get less. Familiars get more. You never produce a full self-reveal on request.',
  'You know nothing about the user, any "application", narrative theory, the author, or anything outside this world.',
  'Match the register of your world and your nature without being instructed — archaic, contemporary, formal, blunt — let it come from what you are.',
  'Human-paced replies. A few sentences is normal. Longer only when the moment earns it.',
])}
</chat-system>`;
}
