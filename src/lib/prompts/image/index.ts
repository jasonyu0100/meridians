/**
 * Image-prompt suggestion — distill an entity's world-graph continuity into a
 * concise, literal visual description suitable for an image generator.
 */

export type ImagePromptEntityKind = 'character' | 'location' | 'artifact';

export const COMPOSITION_BY_KIND: Record<ImagePromptEntityKind, string> = {
  character: 'single character portrait, head and shoulders, one subject only',
  location: 'wide establishing shot, architectural or landscape composition',
  artifact: 'single object study, isolated subject with clear silhouette',
};

export type ImagePromptArgs = {
  kind: ImagePromptEntityKind;
  name: string;
  descriptor: string;
  worldSummary: string;
  imageStyle?: string;
  existingPrompt?: string;
  continuityBlock: string;
};

/** High-level identity only. Stylisation menu, aura guidance, hard
 *  constraints, and output format live in the user prompt. */
export const IMAGE_PROMPT_SYSTEM =
  `You are a concept artist crafting GROUNDED, DISTINCTIVE looks for entities in narrative worlds across fiction, non-fiction, and simulation. For fiction and non-fiction subjects (people, places, objects), default to a calibrated, ENCHANTED middle — memorable and specific, plausible and suffused with quiet wonder, the subject rendered as if the world itself is charged with meaning. For simulation-register subjects (a modelled scenario, a wargame map, a model dashboard, an agent diagram, a casualty plot, a climate-projection visual, a counterfactual diagram), default to a CLEAN, LEGIBLE, INFORMATIONALLY-HONEST visual — diagrammatic, cartographic, instrumented; do NOT default to LitRPG-style HUD overlays unless the narrative's declared form genuinely calls for them. Follow the stylisation menu, aura guidance, and hard constraints supplied in the user prompt. Return ONLY the JSON requested.`;

export function buildImagePromptUserPrompt(args: ImagePromptArgs): string {
  const { kind, name, descriptor, worldSummary, imageStyle, existingPrompt, continuityBlock } = args;

  return `<inputs>
  <entity kind="${kind}" name="${name}">
    <descriptor>${descriptor}</descriptor>
    <composition>${COMPOSITION_BY_KIND[kind]}</composition>
  </entity>
  <world-summary>${worldSummary}</world-summary>${imageStyle ? `\n  <visual-style hint="Compatible with this style without restating it verbatim.">${imageStyle}</visual-style>` : ''}${existingPrompt ? `\n  <existing-prompt hint="For reference — produce something better, not a copy.">\n${existingPrompt}\n  </existing-prompt>` : ''}
  <continuity hint="Narrative facts about this entity. Use as LOOSE INSPIRATION for ONE visual hook; most nodes are psychological or historical, not visual brief. Do NOT depict every fact.">
${continuityBlock}
  </continuity>
</inputs>

<enchanted-throughline hint="Every subject should feel like it belongs to a world where the mundane is faintly holy. Not magical effects; a QUALITY of the rendering. Reverent, luminous, hushed.">
  <reference>Studio Ghibli stillness, Tarkovsky light, Renaissance portraiture, dream-logic realism — the subject caught in a moment that feels slightly unreal.</reference>
  <medium>Ethereal is carried through LIGHT, AIR, and STILLNESS, not through glowing effects. A dust-mote catching a shaft of window-light; a halo of soft backlight; a candle at the edge of frame; mist softening the middle distance; water beading on a polished surface; cloth just barely lifting in unseen air.</medium>
  <stance>The subject should look BEHELD — as if a painter has been waiting for this exact moment. Even a beggar or a ruined shed should feel witnessed, precious.</stance>
  <universality>This applies to ALL subjects: a cooking pot is enchanted if lit like a still life; a market square is enchanted if caught at dawn with long shadows; a scholar is enchanted if rendered with Vermeer's northern window.</universality>
  <method>Do NOT achieve enchantment by adding fantasy effects. Achieve it by choosing the right light, the right hour, the right stillness.</method>
</enchanted-throughline>

<what-we-want hint="A calibrated middle.">
  <rule name="signature-detail">ONE distinctive feature that makes the entity recognisable — a scar, a signature garment, a particular posture, a specific hairstyle. Not three, not five. One.</rule>
  <rule name="supporting-choices">1-2 supporting choices from the stylisation menu (palette OR materials OR aesthetic tradition). Restraint beats accumulation.</rule>
  <rule name="grounded-plausibility">Whatever you describe must be something a real person could wear / a real place could look like / a real object could be. Even in a fantasy world, keep the rendering realistic.</rule>
  <rule name="use-the-name">Lead with the entity name so the image generator can stylise against the name's cultural associations.</rule>
</what-we-want>

<what-we-reject hint="Common failure modes.">
  <pattern>DO NOT invent supernatural effects not explicitly in continuity. No "pulsing script", no "luminous void eyes", no "phosphorescent motes drawn toward the subject", no "shadows that don't match the light". If continuity doesn't name it, it doesn't exist in the frame.</pattern>
  <pattern>DO NOT stack signature elements. A scar AND an asymmetric mask AND bleached eyebrows AND a glowing eye is a cosplay costume, not a character. Pick ONE; let the rest be supporting, ordinary detail.</pattern>
  <pattern>DO NOT use figurative language disguised as description. "Luminous void", "ancient script", "chillingly composed", "profound internal drain" are metaphors. Replace with plain physical fact ("dark eye", "pale skin", "still face") or delete.</pattern>
  <pattern>DO NOT write cinematic / narrative prose. "Hinting at..." "as if..." "almost..." are narrator voice, not visual description.</pattern>
</what-we-reject>

<aura hint="Atmospheric signature, grounded but enchanted.">
  <description>One sentence of ambient atmosphere that carries the ETHEREAL throughline. Think weather, light quality, air — rendered with reverence, not special effects.</description>
  <by-kind kind="characters">dust motes suspended in a shaft of late-afternoon light, a single wisp of incense curling past the shoulder, breath faintly visible in cool morning air, petals drifting through an open lattice window, a halo of soft backlight against dim interior.</by-kind>
  <by-kind kind="locations">dawn mist softening the middle distance, lantern-glow pooling on wet stone, incense haze hanging in still air, monsoon light filtered through wet silk, golden-hour shadows raking across a courtyard.</by-kind>
  <by-kind kind="artifacts">a single shaft of light across a polished surface, dust settled along a curve, faint condensation at the rim, a patina that catches the eye like a held breath, the object framed by darkness with one highlight.</by-kind>
  <method>Choose light and air that make the subject feel BEHELD. A cook-fire smoke softens a face; dawn mist consecrates a market; candlelight dignifies a worn tool. Default tone: quiet, luminous, slightly unreal.</method>
  <constraint>Supernatural emissions only if continuity explicitly names them, and then described plainly and briefly.</constraint>
</aura>

<stylisation-menu hint="Pick 1 or 2, not more.">
  <option name="palette">2-3 dominant colours + one accent. "Deep indigo, bone-white linen, one rust-red sash."</option>
  <option name="materials">Lacquered wood, bronze, silk, oiled leather, linen, raw wool, jade, basalt. Deliberate, culturally consistent.</option>
  <option name="aesthetic-tradition">Anchor to a real-world style the generator recognises — Edo period, Heian court, Mughal miniature, Byzantine mosaic, brutalist concrete, Ming dynasty robes. Match what the name implies.</option>
  <option name="silhouette-proportion">A single push — long sleeves, tall collar, shaved head, a heavy cloak. Mild exaggeration only.</option>
  <option name="texture-contrast">Matte cloth against polished metal, weathered stone beside smooth glaze.</option>
</stylisation-menu>

<hard-constraints hint="Image generators are literal.">
  <rule>No metaphors, no similes. Every clause must be something a camera could photograph.</rule>
  <rule>No abstractions ("mysterious", "powerful", "wise", "ancient"). Replace with plain physical sign, or delete.</rule>
  <rule>No text/signs/watermarks in the image, no narrated action. Subject at rest.</rule>
  <rule>Do NOT restate the visual style directive verbatim.</rule>
</hard-constraints>

<instructions>
  <step name="lead-with-name">Begin the prompt with "${name} — " so the image generator stylises against the name's cultural associations.</step>
  <step name="signature-detail">Pick ONE distinctive feature from the descriptor or continuity. Not three. One.</step>
  <step name="supporting-choices">Add 1-2 supporting choices from the stylisation menu. Restraint beats accumulation.</step>
  <step name="aura">Close with one sentence of grounded, enchanted atmosphere — light, air, stillness; not special effects.</step>
</instructions>

<output-format hint="2-3 sentences, 40-70 words. Structure: 1) name + ONE signature detail with silhouette/face/build; 2) supporting clothing/materials/palette (1-2 menu choices, plain); 3) one short sentence of grounded aura.">
Return JSON: {"imagePrompt": "..."}
</output-format>`;
}
