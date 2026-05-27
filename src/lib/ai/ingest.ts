import { callGenerate } from './api';
import { DEFAULT_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import type { ProseProfile } from '@/types/narrative';
import {
  buildIngestProseProfilePrompt,
  buildRefineProseProfilePrompt,
  buildProseSamplePrompt,
  INGEST_PROSE_PROFILE_SYSTEM,
  REFINE_PROSE_PROFILE_SYSTEM,
  PROSE_SAMPLE_SYSTEM,
} from '@/lib/prompts';
import { logError, logInfo } from '@/lib/system-logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseProfileJson(parsed: any): ProseProfile {
  return {
    register:       typeof parsed.register === 'string'       ? parsed.register       : 'conversational',
    stance:         typeof parsed.stance === 'string'         ? parsed.stance         : 'close_third',
    tense:          typeof parsed.tense === 'string'          ? parsed.tense          : undefined,
    sentenceRhythm: typeof parsed.sentenceRhythm === 'string' ? parsed.sentenceRhythm : undefined,
    interiority:    typeof parsed.interiority === 'string'    ? parsed.interiority    : undefined,
    dialogueWeight: typeof parsed.dialogueWeight === 'string' ? parsed.dialogueWeight : undefined,
    devices:        Array.isArray(parsed.devices) ? parsed.devices.filter((d: unknown) => typeof d === 'string') : [],
    rules:          Array.isArray(parsed.rules)   ? parsed.rules.filter((r: unknown) => typeof r === 'string')   : [],
    antiPatterns:   Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
  };
}

/**
 * Parse pasted text (prose sample, style guide, author analysis) into a
 * ProseProfile. Replaces whatever draft is in flight — use refineProseProfile
 * when the user wants to keep the existing draft and only update what the
 * guidance touches.
 */
export async function ingestProseProfile(text: string, existing?: Partial<ProseProfile>): Promise<ProseProfile> {
  const existingBlock = existing ? JSON.stringify(existing, null, 2) : undefined;
  const prompt = buildIngestProseProfilePrompt(text, existingBlock);

  logInfo('Ingesting prose profile from sample', {
    source: 'ingest',
    operation: 'ingest-prose-profile',
    details: { sampleLength: text.length, hasExisting: !!existing },
  });

  let raw: string;
  try {
    raw = await callGenerate(prompt, INGEST_PROSE_PROFILE_SYSTEM, undefined, 'ingestProseProfile', DEFAULT_MODEL);
  } catch (err) {
    logError('ingestProseProfile call failed', err, {
      source: 'ingest',
      operation: 'ingest-prose-profile',
    });
    throw err;
  }
  return normaliseProfileJson(parseJson(raw, 'ingestProseProfile'));
}

/**
 * Refine an existing profile against user guidance — pasted prose, editorial
 * notes, or a natural-language instruction ("make it more clinical"). Fields
 * the guidance does not touch are preserved.
 */
export async function refineProseProfile(existing: Partial<ProseProfile>, guidance: string): Promise<ProseProfile> {
  const existingBlock = JSON.stringify(existing, null, 2);
  const prompt = buildRefineProseProfilePrompt(existingBlock, guidance);

  logInfo('Refining prose profile', {
    source: 'ingest',
    operation: 'refine-prose-profile',
    details: { guidanceLength: guidance.length },
  });

  let raw: string;
  try {
    raw = await callGenerate(prompt, REFINE_PROSE_PROFILE_SYSTEM, undefined, 'refineProseProfile', DEFAULT_MODEL);
  } catch (err) {
    logError('refineProseProfile call failed', err, {
      source: 'ingest',
      operation: 'refine-prose-profile',
    });
    throw err;
  }
  return normaliseProfileJson(parseJson(raw, 'refineProseProfile'));
}

/** A taste-test seed pins the content so voice is the only variable across
 *  samples. The `category` is shown to the user as the testing axis; the
 *  `paradigm` is which world-shape this seed is built for (fiction, essay,
 *  simulation, atlas, panel, debate, record, non-fiction, or "agnostic" for
 *  seeds that work for any). The `prompt` is what the LLM sees — CHARACTER
 *  / SETTING / ACTION / detail are pinned. */
export type TasteTestSeedParadigm =
  | 'fiction'
  | 'non-fiction'
  | 'simulation'
  | 'essay'
  | 'panel'
  | 'atlas'
  | 'debate'
  | 'record'
  | 'agnostic';

export type TasteTestSeed = {
  /** Label shown to the user — the voice muscle this seed exercises. */
  category: string;
  /** Which paradigm this seed is shaped for. */
  paradigm: TasteTestSeedParadigm;
  /** What the LLM is given. Structured tags so the model cannot drift content. */
  prompt: string;
};

/** Pre-baked scenarios for the blind taste test. Each exercises a DIFFERENT
 *  voice muscle — interior stillness, action, dialogue, technical mechanism,
 *  argument, sensory rendering, decision under pressure, system overlay, etc.
 *  A profile that wins on stillness may lose on action; this set surfaces
 *  those asymmetries instead of hiding them. */
export const TASTE_TEST_SEEDS: TasteTestSeed[] = [
  // ── Fiction ──────────────────────────────────────────────────────────────
  {
    category: 'Interior · quiet observation',
    paradigm: 'fiction',
    prompt:
      'CHARACTER: Tomas, a 60-year-old man, alone. SETTING: His childhood bedroom, untouched for 40 years. Dust on every surface. Late afternoon light through a thin curtain. ACTION: He stands just inside the doorway and looks at the bed. OBSERVATION (the only change he notices): a single white feather lying on the pillow.',
  },
  {
    category: 'Action · physical tension',
    paradigm: 'fiction',
    prompt:
      'CHARACTER: Yara, a courier in her late twenties, midstride. SETTING: A flat tar rooftop at night, six storeys up, the next building two metres across a gap. Two pursuers are eight metres behind her, gaining. The bag strapped to her chest is heavy. ACTION: She does not break stride. She jumps the gap. EVENT (during the jump): the strap of the bag begins to slip from her shoulder.',
  },
  {
    category: 'Dialogue · two-person tension',
    paradigm: 'fiction',
    prompt:
      'CHARACTERS: Dr Owens (the surgeon, exhausted) and Pia (the patient\'s wife, awake for thirty hours). SETTING: A hospital corridor at 5am, vending machine humming behind them, no one else present. ACTION: Owens stops in front of Pia. He says, exactly: "He\'s awake." Render exactly three further exchanges of dialogue between them, ending on Pia\'s line. Include only the dialogue and what is strictly necessary to ground it (posture, breath, where the eyes go). No backstory.',
  },
  {
    category: 'Sensory · place without action',
    paradigm: 'fiction',
    prompt:
      'CHARACTER: Idris, a baker, alone. SETTING: His commercial kitchen, 4am, before any staff arrive. ACTION: He opens the oven door to check a slow ferment that has been proofing overnight. EVENT: He does not do anything else — no dialogue, no further movement, no second observation. The seed is the kitchen and the moment of opening the oven. Render heat, smell, sound, light. End on the loaves visible inside.',
  },
  {
    category: 'Decision · under pressure',
    paradigm: 'fiction',
    prompt:
      'CHARACTER: Dr Lee, a surgeon, mid-operation. SETTING: An operating theatre, three other staff present but unnamed and silent. ACTION: A piece of equipment has just failed — the anaesthesia monitor has gone dark, but the patient\'s vitals on the secondary read normal. EVENT: Lee has 30 seconds to decide whether to continue or pause. Render the decision being made — what she weighs, what she sees, what she says, and the verdict. End on her verdict.',
  },
  {
    category: 'Reveal · moment of recognition',
    paradigm: 'fiction',
    prompt:
      'CHARACTER: Mireille, a detective in her fifties, alone. SETTING: Her office, late evening. A journal lies open on her desk under a desk lamp. ACTION: She reads the final paragraph of the journal. EVENT: The paragraph contains a date that proves a witness lied — she now knows who. Render only the moment of recognition, in the seconds AFTER she finishes reading. The lie\'s content is unimportant; what matters is the click landing.',
  },
  {
    category: 'World density · arrival',
    paradigm: 'fiction',
    prompt:
      'CHARACTER: Eshe, a traveller in her thirties, alone, carrying one bag. SETTING: She has just stepped off a boat onto the dock of Port Halab, a city she has never seen. EVENT: This is the first paragraph of the piece — establish the port in one breath: light, sound, traffic, language, smell, the kind of city it is, and an implied stake (something is at risk, but do not say what). Eshe does not move beyond the dock. No dialogue. No second character.',
  },

  // ── Simulation ───────────────────────────────────────────────────────────
  {
    category: 'Technical · mechanism under stress',
    paradigm: 'simulation',
    prompt:
      'CHARACTER: Jin, a field engineer, alone. SETTING: A maintenance pit beneath a coastal turbine, salt air, a single bulb overhead. ACTION: He runs a diagnostic on a failing capacitor bank. He records three readings in succession. EVENT: Each reading is worse than the previous (0.62, then 0.41, then 0.18 of nominal). The third reading means the bank cannot be saved. Render the moment, the readings, and the conclusion. No other characters.',
  },
  {
    category: 'System overlay · diegetic stats',
    paradigm: 'simulation',
    prompt:
      'CHARACTER: Ren, a cultivator at the threshold of an inscribed duelling ring. SETTING: A stone amphitheatre, dusk, two thousand spectators silent. RULE-SET: Combatants enter with a visible stat-block — qi reserve, technique tier, soul-strength. ACTION: Ren steps into the ring. EVENT: His own stat-block surfaces in his perception, and so does his opponent\'s; the opponent\'s reserve is 1.7× his own. Render the moment, the readings, and Ren\'s recalculation of his plan. Use diegetic overlay (numbers, tiers, gates) as part of the prose, not as floating UI.',
  },
  {
    category: 'Scenario · branch under rules',
    paradigm: 'simulation',
    prompt:
      'VOICE: A scenario analyst rendering a 2026 wargame branch as in-world events. SETTING: A naval exclusion zone in the South China Sea, day 4 of the scenario. RULE-SET: The exercise uses fixed ROE — three escalation steps, each requiring named political authorisation. ACTION: A patrol vessel from Side Blue crosses the exclusion line at 03:14. EVENT: Side Red\'s on-scene commander has authority for step 1 only. Render step 1 being executed — the orders, the action taken, and the immediate effect. Use the rule numbers and step labels in the prose. No omniscient narrator framing.',
  },

  // ── Essay ────────────────────────────────────────────────────────────────
  {
    category: 'Argument · claim under defence',
    paradigm: 'essay',
    prompt:
      'VOICE: An essayist (no named character, no scene). TASK: Open an essay with this exact claim as its first sentence — "Markets do not aggregate information; they aggregate confidence." Defend the claim in the remaining 120-160 words. ALLOWED: one concrete example (markets, sport, elections, anything). NOT ALLOWED: a story, a character, a scene, a fictional frame. The piece is a non-fiction opening paragraph.',
  },
  {
    category: 'Internal friction · qualified commitment',
    paradigm: 'essay',
    prompt:
      'VOICE: A single essayist working through an objection to their own thesis. TASK: The thesis under examination is "Forecast accuracy degrades faster than forecasters admit." The essayist surfaces one strong counter-reading (forecasters DO recalibrate; the degradation is real but bounded), considers it seriously, and commits anyway — but with the commitment narrowed by what the counter-reading forced them to concede. NOT ALLOWED: dialogue between interlocutors; manufactured exchange. Internal friction only. 130-170 words.',
  },

  // ── Panel ────────────────────────────────────────────────────────────────
  {
    category: 'Panel · cognition over evidence',
    paradigm: 'panel',
    prompt:
      'PANEL: Two researchers — Dr Vance (quantitative methods) and Dr Okafor (qualitative methods) — review an existing dataset of 412 case files on hospital readmission. NO FORWARD-TIME EVENTS: they do not act, travel, or change the world; they cognise over what already exists. ACTION: They identify one pattern in the data — readmission spikes correlate with shift-handover hours, not with case severity. EVENT: Vance proposes one mechanism; Okafor proposes a competing one. Render the section as a panel exchange — attributed, evidence-anchored, no scene-action. 140-180 words.',
  },

  // ── Atlas ────────────────────────────────────────────────────────────────
  {
    category: 'Atlas · typology entry',
    paradigm: 'atlas',
    prompt:
      'ENTRY TYPE: A taxonomic entry for the form "Foundational Charter" as a class of governance document (constitutions, declarations, founding manifestos). NO NARRATIVE: do not tell a story about a charter; classify the form itself. Render the entry with: typical structural attributes (3-5), distinguishing features against neighbouring forms (statute, treaty, mission statement), and one canonical specimen named by reference. The piece reads as a reference work, not a scene. 130-170 words.',
  },

  // ── Debate ───────────────────────────────────────────────────────────────
  {
    category: 'Debate · opening move under rules',
    paradigm: 'debate',
    prompt:
      'DEBATE FORMAT: Formal Lincoln-Douglas, value vs criterion. RESOLUTION: "Resolved: AI systems with persistent memory should be granted legal personhood." MOVE: The Affirmative\'s opening case — value premise stated, criterion stated, two contentions previewed. ATTRIBUTION: Every claim is the Affirmative speaker\'s position. RULES: This is a move in a contest, not a fiction scene. No omniscient framing, no internal monologue, no setting description beyond what the format demands. 140-180 words.',
  },

  // ── Record ───────────────────────────────────────────────────────────────
  {
    category: 'Record · dated chronicle entry',
    paradigm: 'record',
    prompt:
      'CHRONICLER VOICE: A town clerk maintaining the municipal record of Avonford. ENTRY DATE: 14 October 1849. EVENTS OF THE DAY: (1) The river rose two feet overnight after upstream rains. (2) The miller petitioned for damages — the south bridge approach is undermined. (3) Council voted 4-2 to authorise emergency repairs at no more than £18. Render the entry in the clerk\'s documentary voice — what happened, in what order, what was decided, what remains open. NO narrative framing, no character interiority, no atmosphere. 110-150 words.',
  },

  // ── Non-fiction ──────────────────────────────────────────────────────────
  {
    category: 'Non-fiction · documented event',
    paradigm: 'non-fiction',
    prompt:
      'SOURCE: The published minutes of a real meeting (treat as authoritative). EVENT: The Apollo 11 crew\'s pre-launch breakfast on 16 July 1969. WHAT THE RECORD CONTAINS: the time (4:15am EDT), the menu (steak, eggs, toast, coffee), the people present (the crew, Deke Slayton, a small support team), and that the conversation was light. WHAT THE RECORD DOES NOT CONTAIN: any specific dialogue. Render the moment in non-fiction prose — what happened, who was present, what they did. Where the record is silent, name the silence ("the minutes do not record what was said"). NO fabricated dialogue. NO invented interiority. 130-170 words.',
  },
];

/**
 * Generate a short prose sample that exercises a given profile against a
 * shared seed scenario. Used by the blind taste test — multiple samples on
 * the same seed, different profiles, anonymised for the user to compare.
 */
export async function generateProseSample(profile: ProseProfile, seedScenario: string): Promise<string> {
  const profileBlock = JSON.stringify(profile, null, 2);
  const prompt = buildProseSamplePrompt(profileBlock, seedScenario);

  let raw: string;
  try {
    raw = await callGenerate(prompt, PROSE_SAMPLE_SYSTEM, undefined, 'generateProseSample', DEFAULT_MODEL);
  } catch (err) {
    logError('generateProseSample call failed', err, {
      source: 'ingest',
      operation: 'generate-prose-sample',
    });
    throw err;
  }
  return raw.trim();
}
