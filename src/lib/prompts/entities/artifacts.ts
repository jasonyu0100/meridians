/**
 * Artifact Usage Prompt — XML block injected into user prompts that reason
 * about artifacts.
 */

export const PROMPT_ARTIFACTS = `<artifacts hint="Concrete things an entity can USE, possess, cite, transfer, or invoke under the rules. Pick examples from the work's own palette; do not default to any single register.">
  <example type="good" kind="objects-and-tools">a ceremonial dagger, a jian, a talking drum, a rosary, a wax-seal, a treaty draft, a family heirloom manuscript, a recurring motif object — things wielded or carried.</example>
  <example type="good" kind="documents-and-records">a field notebook, an archival microfilm, a dossier, a court filing, a clinical record, a shipping manifest, a primary-source letter — concrete artefacts that can be cited or transferred.</example>
  <example type="good" kind="research-and-work-tools">GPT-4, TensorFlow, a WMT dataset, a P100 GPU, a spectrometer — software, hardware, and datasets that are USED.</example>
  <example type="good" kind="rule-bearing-instruments">a binding treaty that constrains state behaviour, a tariff schedule that gates trade flows, a calibrated measurement device that certifies a finding, a charter that defines an institution's powers, a cultivation pill or technique manual whose effect is fixed by the world's rules — concrete instruments whose use triggers stated mechanisms.</example>
  <example type="good" kind="simulation-initial-conditions">a 1962 NSC briefing folder, a treaty draft, a Politburo decision-rule playbook, a sect's succession charter, a regional grain ledger — concrete in-world documents the modelled events run from. (NOT "the calibration table the modellers used" — that's meta infrastructure, not in-world artefact.)</example>
  <example type="good" kind="diegetic-rule-readouts" hint="ONLY when the modelled WORLD itself contains these as objects characters interact with. A LitRPG character's stat block (the world has stats), a cultivator's tier gate (the world has tiers), a general's wargame turn report (the wargame is in-world), an in-world epidemiologist's published bulletin during an outbreak narrative. NEVER an out-of-frame researcher's dashboard about the work.">a tier-gate certificate that an apprentice physically holds, a status sheet a LitRPG character literally sees, a turn report passed between commanders inside the wargame fiction, a bulletin an in-world Ministry of Health publishes during the outbreak.</example>
  <example type="bad" reason="meta infrastructure — the simulation engine is implementation, not an in-world entity" kind="anti-meta">"the Vásquez Institute's forecast bulletin", "the Simulation Core's dashboard print", "the hidden dampener parameter", "the modelled-grain-price ticker on the analyst's desk" — unless the PREMISE explicitly is "a narrative about an institute that runs simulations", these are leakage of internal machinery into the world.</example>
  <example type="bad" reason="concepts belong in system knowledge">"Magic", "swordsmanship", "alchemy".</example>
  <example type="bad" reason="techniques/metrics belong in system knowledge">"Transformer architecture", "dropout", "BLEU score", "thermodynamics".</example>
  <example type="bad" reason="internal references, not standalone artifacts">"Figure 3", "Table 2", "footnote 14".</example>
  <rule name="ownership">parentId is a character, location, or null (world-owned for ubiquitous tools like AI, the internet, shared infrastructure, public archives, or universally-available rule instruments).</rule>
  <rule name="transfer">ownershipDelta when artifacts change hands.</rule>
  <rule name="usage">artifactUsage records who wielded or invoked it — every usage names a wielder. Where the artifact is rule-bearing, the usage entry should state which mechanism it triggered.</rule>
</artifacts>`;
