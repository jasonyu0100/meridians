/**
 * World expansion USER prompt — adds entities (characters, locations,
 * artifacts), threads, and system rules to an existing work. Templated with
 * size, source-text, entity-filter. The matching SYSTEM prompt lives in
 * `paradigm-analyst.ts` and dispatches on paradigm.
 */

import { PROMPT_ENTITY_INTEGRATION } from '../entities/integration';
import { modePriorityEntry } from '../phase/application';
import type { ExpansionSizeConfig, WorldExpansionSize } from './expansion-suggestion';

export const EXPANSION_SIZE_CONFIG: Record<WorldExpansionSize, ExpansionSizeConfig> = {
  small:  { total: '3-6',   characters: '1-2',   locations: '1-2',   threads: '1-2',   label: 'a focused expansion (~5 total entities)' },
  medium: { total: '10-15', characters: '3-5',   locations: '3-4',   threads: '3-5',   label: 'a moderate expansion (~12 total entities)' },
  large:  { total: '20-35', characters: '8-15',  locations: '6-10',  threads: '8-12',  label: 'a large-scale expansion (~30 total entities)' },
  exact:  { total: 'as specified', characters: 'as specified', locations: 'as specified', threads: 'as specified', label: 'exactly what is described in the directive — nothing more, nothing less' },
};

export type ExpandWorldArgs = {
  context: string;
  directive: string;
  sourceText?: string;
  size: WorldExpansionSize;
  /** Pre-built entity-filter block (or empty when no types disabled). */
  entityFilterBlock: string;
  /** Active phase graph rendered as a `<mode>` block (or empty). */
  modeSection?: string;
  existingCharList: string;
  existingLocList: string;
  existingRelList: string;
  nextCharId: string;
  nextLocId: string;
  nextThreadId: string;
  nextArtifactId: string;
  nextKId: string;
};

/** Output schema for expandWorld — exact JSON shape the model must emit.
 *  Exported so the LLM-assisted repair path can reuse the same schema spec
 *  instead of a drift-prone hand-written copy. Single source of truth for
 *  both generation and repair. */
export function buildExpandWorldOutputSchema(args: { nextCharId: string; nextLocId: string; nextThreadId: string; nextArtifactId: string; nextKId: string }): string {
  const { nextCharId, nextLocId, nextThreadId, nextArtifactId, nextKId } = args;
  return `{
  "summary": "1-2 sentences (≤ 40 words). Plain prose. State the INTENT of this expansion — what creative space it opens, what tension it primes, what entities/factions/rules it brings into play.",
  "characters": [
    {
      "id": "${nextCharId}",
      "name": "Full name matching the world's naming register",
      "role": "anchor|recurring|transient",
      "threadIds": [],
      "imagePrompt": "1-2 sentence LITERAL physical description: concrete traits like hair colour, build, clothing style.",
      "world": {
        "nodes": [{"id": "${nextKId}", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense"}]
      }
    }
  ],
  "locations": [
    {
      "id": "${nextLocId}",
      "name": "Location name — concrete and specific",
      "parentId": "REQUIRED: existing location ID, or null ONLY for top-level regions",
      "tiedCharacterIds": ["character IDs with significant ties — residents, employees, faction members"],
      "threadIds": [],
      "imagePrompt": "1-2 sentence LITERAL visual description.",
      "world": {
        "nodes": [{"id": "K-next", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense"}]
      }
    }
  ],
  "threads": [
    {
      "id": "${nextThreadId}",
      "participants": [{"id": "character or location ID", "type": "character|location|artifact"}],
      "description": "Frame as a QUESTION — 15-30 words, specific conflict",
      "outcomes": ["Named possibilities. Binary default ['yes','no']. 2–6 distinct, mutually-exclusive entries."],
      "horizon": "short | medium | long | epic",
      "dependents": ["T-XX existing thread IDs this thread connects to"]
    }
  ],
  "artifacts": [
    {
      "id": "${nextArtifactId}",
      "name": "Artifact name — concrete and specific",
      "significance": "key|notable|minor",
      "parentId": "owner — character or location ID, or null for world-owned",
      "world": {"nodes": [{"id": "K-next", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense"}]},
      "imagePrompt": "1-2 sentence LITERAL visual description"
    }
  ],
  "systemDeltas": {
    "addedNodes": [{"id": "SYS-GEN-1", "concept": "15-25 words, PRESENT tense", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}],
    "addedEdges": [{"from": "SYS-GEN-1", "to": "existing-SYS-ID", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]
  },
  "threadDeltas": [{"threadId": "T-XX", "logType": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "updates": [{"outcome": "outcome name from thread.outcomes", "evidence": 1.5}], "volumeDelta": 1, "addOutcomes": ["optional"], "rationale": "10-20 words, prose only"}],
  "worldDeltas": [{"entityId": "existing C-XX, L-XX, or A-XX", "addedNodes": [{"id": "K-next", "content": "15-25 words, PRESENT tense", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "short relation label", "valenceDelta": 0.1}],
  "ownershipDeltas": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
  "tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}],
  "attributions": ["C-XX", "L-XX", "T-XX", "SYS-XX"],
  "attributionEdges": [{"from": "C-XX", "to": "SYS-XX", "relation": "requires|enables|constrains|risks|causes|reveals|develops|resolves|supersedes"}]
}`;
}

export function buildExpandWorldPrompt(args: ExpandWorldArgs): string {
  const {
    context,
    directive,
    sourceText,
    size,
    entityFilterBlock,
    modeSection,
    existingCharList,
    existingLocList,
    existingRelList,
    nextCharId,
    nextLocId,
    nextThreadId,
    nextArtifactId,
    nextKId,
  } = args;

  const sizeConfig = EXPANSION_SIZE_CONFIG[size];

  return `<inputs>
  <narrative-context>
${context}
  </narrative-context>
${modeSection ? `\n  ${modeSection.replace(/\n/g, '\n  ')}\n` : ''}
  <directive hint="${directive.trim() ? 'Primary creative brief — drive the expansion off this.' : 'No directive — analyse the current narrative state and add what most extends existing tensions or opens unexplored areas.'}">
${directive.trim() ? directive : 'EXPAND the world — analyse the current narrative state and add characters, locations, and threads that extend existing tensions or open unexplored areas.'}
  </directive>
${sourceText ? `  <source-material hint="Verbatim from plan document — use as the authoritative guide. If the source names specific characters, places, or objects, create them with those exact names and roles. Source takes priority over generic expansion.">\n${sourceText}\n  </source-material>` : ''}

${entityFilterBlock ? `  <entity-filter>\n${entityFilterBlock}\n  </entity-filter>` : ''}

  <size-mode kind="${size}" label="${sizeConfig.label}" total="${sizeConfig.total}">
${size === 'exact' ? `    <rule>EXACT expansion — create ONLY what the directive explicitly describes. Do not add extra entities, threads, or artifacts beyond what is specified. No embellishments, no "while we're at it" additions. If the directive names a single entity, create exactly that entity and nothing else. Every entity in your response must trace directly to something stated in the directive.</rule>` : `    <target characters="${sizeConfig.characters}" locations="${sizeConfig.locations}" threads="${sizeConfig.threads}" />`}
    <always-include>
      <rule>relationshipDeltas connecting new characters to EXISTING characters (use valenceDelta as initial valence for new pairs).</rule>
      <rule>Artifacts when the directive or narrative calls for them — objects, documents, instruments, or sources that grant capabilities and drive acquisition, conflict, or discovery. Not every expansion needs artifacts.</rule>
    </always-include>
  </size-mode>

  <existing-entities hint="You MUST reference these to integrate new content. Orphaned, disconnected entities are useless.">
    <characters>${existingCharList}</characters>
    <locations>${existingLocList}</locations>
    <relationships>${existingRelList || 'none yet'}</relationships>
  </existing-entities>
</inputs>

<integration-hierarchy hint="When inputs conflict, this is the priority order for expansion decisions.">
  <priority rank="1">DIRECTIVE / SOURCE-MATERIAL — explicit creative brief; the expansion must serve these directly. Source-material (when present) is verbatim authority over names, roles, and specifics.</priority>
  <priority rank="2">SIZE-MODE — the entity-count budget; shapes how much the expansion adds.</priority>
  ${modePriorityEntry(3, "expand")}
  <priority rank="4">EXISTING-ENTITIES — the canon the expansion must integrate with; new content references these to avoid orphaning.</priority>
  <priority rank="5">ENTITY-FILTER — toggles for which delta types are emitted; structural, not creative.</priority>
</integration-hierarchy>

<output-format>
Use sequential IDs continuing from the existing ones.

Return JSON with this exact structure:
${buildExpandWorldOutputSchema({ nextCharId, nextLocId, nextThreadId, nextArtifactId, nextKId })}
</output-format>

<id-rules>
  <rule>Character IDs: continue sequentially from ${nextCharId} (e.g., ${nextCharId}, C-${parseInt(nextCharId.split('-').pop()!) + 1}, ...).</rule>
  <rule>Location IDs: continue sequentially from ${nextLocId} (e.g., ${nextLocId}, L-${parseInt(nextLocId.split('-').pop()!) + 1}, ...).</rule>
  <rule>Thread IDs: continue sequentially from ${nextThreadId} (e.g., ${nextThreadId}, T-${parseInt(nextThreadId.split('-').pop()!) + 1}, ...).</rule>
  <rule>Artifact IDs: continue sequentially from ${nextArtifactId} (e.g., ${nextArtifactId}, A-${parseInt(nextArtifactId.split('-').pop()!) + 1}, ...).</rule>
  <rule>Knowledge node IDs: continue sequentially from ${nextKId} (e.g., ${nextKId}, K-${parseInt(nextKId.split('-').pop()!) + 1}, ...).</rule>
  <rule>No leading zeros — write C-7, not C-07. The pipeline rejects zero-padded duplicates.</rule>
  <rule>ALL knowledge nodes (in both characters and locations) use the K- prefix and share one sequence.</rule>
</id-rules>

<entity-integration>
${PROMPT_ENTITY_INTEGRATION}
</entity-integration>

<expansion-specific-rules>
  <rule>Generate at MINIMUM ${sizeConfig.characters === '1-2' ? '2' : sizeConfig.characters === '3-5' ? '5' : '12'} relationshipDeltas total. Most should connect new→existing characters. Use valenceDelta as initial valence for new pairs. Include varied valences (allies, rivals, mentors, kin, collaborators, antagonists). At least one with tension.</rule>
  <rule>Key artifacts should have 3-4 world nodes (what it is, its origin, its limitation). Only create artifacts when they meaningfully alter what entities can do.</rule>
</expansion-specific-rules>

<naming-rules>
  <rule>All new names must match the naming conventions already established in the world. Study the existing character and location names and produce names from the same linguistic roots.</rule>
  <rule>Source from real census records, historical obscurities, occupational surnames, or regional dialects. Names should feel rough, asymmetric, and lived-in — never smooth or melodic in a generic way.</rule>
  <rule>Location names from geography, founders, or corrupted older words. Thread names concrete and specific.</rule>
</naming-rules>

<content-rules>
  <rule>Characters should have meaningful knowledge (3-5 nodes). Give each character SECRETS or unique knowledge that only they possess — knowledge asymmetries drive narrative tension. Include at least one hidden or dangerous piece of knowledge per character.</rule>
  <rule>Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Pick types that fit the narrative's register and world (e.g. "blood_pact", "ancestral_grudge", "unpublished_finding", "off-record_source", "contested_attribution", "institutional_obligation"). Avoid generic labels like "trait" or "fact".</rule>
  <rule>New locations should CONTRAST with existing ones — if the narrative has been set in dense urban cores, add open or remote settings; if in centres of power, add the periphery; if in archives, add the field site; if in seminar rooms, add the laboratory floor or the street. Environmental variety drives scene variety.</rule>
  <rule>Location knowledge should establish what makes each place narratively distinct (2-3 nodes per location — its defining atmosphere, a constraint or danger, and a resource or opportunity it offers).</rule>
  <rule>Threads should introduce DIFFERENT types of open questions than existing ones — if current threads are about conflict, add threads about mystery, loyalty, hidden information, contested interpretation, or whether the modelled rule set drives the world to a further state under altered conditions.</rule>
  <rule>Every new thread declares its OUTCOMES up front — 2+ named, mutually-exclusive possibilities. Binary is default (["yes","no"]); multi-outcome when the resolution is genuinely N-way. Markets open at uniform priors (no outcome is pre-weighted).</rule>
  <rule>New threads start with NO evidence — they're fresh markets. Initial scenes that seed them will emit setup/escalation evidence on the chosen outcome.</rule>
  <rule>Generate the exact counts specified above (${sizeConfig.characters} characters, ${sizeConfig.locations} locations, ${sizeConfig.threads} threads).</rule>
</content-rules>

<thread-convergence hint="Critical for long-form narrative.">
  <rule>The "dependents" field lists EXISTING thread IDs that this new thread connects to, accelerates, or converges with. This is how threads collide.</rule>
  <rule>A convergent thread is one whose activation or resolution forces multiple existing threads into new trajectories. Example: a resource thread (T-new) that depends on [T-3, T-7] means when this resource thread activates, it creates pressure on both T-3 and T-7 simultaneously.</rule>
  <rule>At least ONE new thread should have 2+ dependents — this is a convergent bridge thread that forces collision between existing threads.</rule>
  <rule>Dependents should reference threads that are currently in different parts of the narrative or involve different entities — the whole point is to CREATE connections between threads that were previously parallel.</rule>
  <rule>Think: shared resources multiple factions need, events that affect multiple threads, secrets that connect separated entities, external forces that compress multiple conflicts.</rule>
  <rule>Empty dependents [] is acceptable for truly independent new threads, but at least one thread per expansion MUST bridge existing threads.</rule>
</thread-convergence>

<system-knowledge-deltas hint="systemDeltas define the FOUNDATIONAL abstractions this expansion establishes — the rules, mechanisms, gates, propagation laws, causal couplings, concepts, and tensions that the new entities operate within. Intentional world-building, not incidental discovery. In rule-driven works the system layer is load-bearing — it IS the substrate driving consequence — so the expansion must extend that substrate, not decorate it.">
  <rule>Use "principle" for fundamental truths, "system" for mechanisms/institutions/gate conditions/propagation laws, "concept" for abstract ideas, "tension" for contradictions, "event" for world-level occurrences, "structure" for organizations/factions, "environment" for geography/climate, "convention" for customs/norms/procedural defaults, "constraint" for scarcities/limitations/causal couplings.</rule>
  <rule>Node IDs should be SYS-GEN-1, SYS-GEN-2, etc. (no leading zeros — they will be re-mapped to real IDs).</rule>
  <rule>Edges can reference both new SYS-GEN-* IDs and existing system knowledge IDs already in the narrative.</rule>
  <rule>Generate ${size === 'small' ? '4-6' : size === 'medium' ? '8-12' : size === 'exact' ? 'as many as the directive calls for' : '15-25'} system knowledge nodes with a comparable number of edges. Each must be a genuine structural rule, mechanism, or gate that the new entities operate within. EDGES ARE CRITICAL — an isolated node contributes 1 to system, but an edge connecting it to an existing SYS node adds √1 more AND wires the expansion into the existing graph.</rule>
  <rule>At least HALF of your edges should cross the new/existing boundary — use existing SYS IDs from the narrative context, not just SYS-GEN-* → SYS-GEN-*. This is how expansions deepen the foundation instead of floating free.</rule>
  <rule>Focus on the structural WHY behind the expansion — what abstract rules, mechanisms, gate conditions, propagation laws, power structures, or tensions make these new entities meaningful?</rule>
</system-knowledge-deltas>

<attribution-skeleton hint="Expansion's contribution to the cumulative network graph. Emit at end.">
  <attributions>Existing ids the expansion structurally engages (C/L/A/T/SYS). Skip newly-introduced ids — they credit at introduction. 0–15 typical.</attributions>
  <attribution-edges>Typed cross-kind connections between attributed ids — character↔system, thread↔location, artifact↔character. Relation: enables, constrains, requires, risks, causes, reveals, develops, resolves, supersedes. Don't duplicate same-kind wiring already in relationshipDeltas / systemDeltas.addedEdges.</attribution-edges>
</attribution-skeleton>`;
}
