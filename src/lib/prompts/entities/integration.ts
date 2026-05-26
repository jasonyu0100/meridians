/**
 * Entity Integration Rules Prompt — XML block injected into user prompts.
 *
 * Shared between world generation and world expansion.
 */

export const PROMPT_ENTITY_INTEGRATION = `<entity-integration>
  <integration-rules>
    <rule name="characters">Characters are agents — people, named figures, sentient actors with their own viewpoint. In simulation register: scenario actors, decision-making agents (commanders, ministers, modelled cultivators, observer-analysts) whose choices feed the rule machinery. Non-sentient AI, instruments, and inert objects are artifacts. Every new character MUST have at least 1 relationship to an existing character.</rule>
    <rule name="locations">Locations are spatial areas — physical sites, venues, regions, institutions tied to a place. In simulation register also: scenario theatres, model regions, agent populations treated as a place (a sect's grounds, a redistribution quadrant, a quarantined district). Every new location SHOULD nest under an existing location via parentId (except top-level regions).</rule>
    <rule name="artifacts" hint="The test: can an entity invoke, wield, cite, or transfer it? 'GPT-4' = artifact. 'Machine learning' = concept (system knowledge). 'A primary-source letter' = artifact. 'Epistolary tradition' = concept. 'A 1962 NSC briefing folder' = artifact. 'Deterrence theory' = concept.">Artifacts are CONCRETE TOOLS, instruments, documents, or objects with specific utility — not abstract concepts. In simulation register also: rule documents (treaties, doctrinal texts, statutes), scenario inputs (calibration datasets, mobility tables), and model outputs (forecast bulletins, status sheets) when entities consult them in-world. Artifacts have parentId: character, location, or null (world-owned for ubiquitous tools like AI, internet, public archives, treaty regimes binding all factions).</rule>
    <rule name="thread-participants">Thread participants MUST include at least one existing entity (character, location, or artifact).</rule>
    <rule name="naming">Names must match the naming conventions already established in the narrative.</rule>
  </integration-rules>

  <initialization-requirement hint="HARD RULE — NO EXCEPTIONS. A blank entity has no readable history and silently zeros out force contributions.">
    <rule name="entity-seed">Every new entity (character, location, artifact) MUST ship with at least 1 node in its world.nodes array at the moment of creation. Empty world graphs are invalid output. Even a transient entity or margin location needs one grounding fact (15-25 words, PRESENT tense) — interiority for a character, history for a location, provenance for an artifact.</rule>
    <rule name="thread-seed">Every new thread MUST open with a threadDelta on the scene that introduces it, and that threadDelta MUST contain at least 1 addedNode (type "setup") recording the seed moment. A thread whose introducing scene carries no log entry is invalid output.</rule>
    <rule name="seed-purpose">These seed entries define the entity's starting position in its own graph.</rule>
  </initialization-requirement>
</entity-integration>`;
