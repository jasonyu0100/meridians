'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { BEAT_PROFILE_PRESETS } from '@/lib/beat-profiles';
import {
  ingestProseProfile,
  refineProseProfile,
  generateProseSample,
  TASTE_TEST_SEEDS,
  type TasteTestSeedParadigm,
} from '@/lib/ai/ingest';
import type { BeatProfilePreset, ProseProfile, SavedProseProfile } from '@/types/narrative';

type Props = { onClose: () => void };

type Mode = 'edit' | 'text' | 'taste';

// ── Derive suggestions from presets ──────────────────────────────────────────

type StringField = 'register' | 'stance' | 'tense' | 'sentenceRhythm' | 'interiority' | 'dialogueWeight';
const STRING_FIELDS: StringField[] = ['register', 'stance', 'tense', 'sentenceRhythm', 'interiority', 'dialogueWeight'];

const FIELD_LABELS: Record<StringField, string> = {
  register:       'Register',
  stance:         'Stance',
  tense:          'Tense',
  sentenceRhythm: 'Rhythm',
  interiority:    'Interiority',
  dialogueWeight: 'Dialogue',
};

function deriveOptions(presets: BeatProfilePreset[], field: StringField): { value: string; sources: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of presets) {
    const v = p.profile[field];
    if (typeof v === 'string' && v.trim()) {
      const entry = map.get(v) ?? [];
      entry.push(p.name);
      map.set(v, entry);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([value, sources]) => ({ value, sources }));
}

function deriveDeviceOptions(presets: BeatProfilePreset[]): { value: string; sources: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of presets) {
    for (const d of p.profile.devices ?? []) {
      if (d.trim()) {
        const entry = map.get(d) ?? [];
        entry.push(p.name);
        map.set(d, entry);
      }
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([value, sources]) => ({ value, sources }));
}

function deriveTemplates(presets: BeatProfilePreset[], key: 'rules' | 'antiPatterns'): string[] {
  const seen = new Set<string>();
  for (const p of presets) {
    for (const r of p.profile[key] ?? []) {
      if (r.trim()) seen.add(r);
    }
  }
  return [...seen];
}

function profileMatchesPreset(draft: Partial<ProseProfile>, preset: ProseProfile): boolean {
  for (const f of STRING_FIELDS) {
    const dv = (draft[f] ?? '').toString().trim();
    const pv = (preset[f] ?? '').toString().trim();
    if (dv !== pv) return false;
  }
  for (const k of ['devices', 'rules', 'antiPatterns'] as const) {
    const a = [...(draft[k] ?? [])].sort();
    const b = [...(preset[k] ?? [])].sort();
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return false;
  }
  return true;
}

function detectPresetKey(profile: Partial<ProseProfile> | undefined, presets: BeatProfilePreset[]): string | null {
  if (!profile) return null;
  for (const p of presets) {
    if (profileMatchesPreset(profile, p.profile)) return p.key;
  }
  return null;
}

// ── Draft ─────────────────────────────────────────────────────────────────────

type Draft = {
  register: string; stance: string; tense: string;
  sentenceRhythm: string; interiority: string; dialogueWeight: string;
  devices: string[]; rules: string[]; antiPatterns: string[];
};

function toDraft(p: Partial<ProseProfile>): Draft {
  return {
    register:       p.register       ?? '',
    stance:         p.stance         ?? '',
    tense:          p.tense          ?? '',
    sentenceRhythm: p.sentenceRhythm ?? '',
    interiority:    p.interiority    ?? '',
    dialogueWeight: p.dialogueWeight ?? '',
    devices:        p.devices        ? [...p.devices] : [],
    rules:          p.rules          ? [...p.rules]   : [],
    antiPatterns:   p.antiPatterns   ? [...p.antiPatterns] : [],
  };
}

/** Attempt to parse text as a literal ProseProfile JSON. Returns null if the
 *  text is not JSON or does not contain at least register/stance fields. */
function tryParseProfileJson(text: string): ProseProfile | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.register !== 'string' || typeof parsed.stance !== 'string') return null;
    return {
      register: parsed.register,
      stance: parsed.stance,
      tense:          typeof parsed.tense === 'string'          ? parsed.tense          : undefined,
      sentenceRhythm: typeof parsed.sentenceRhythm === 'string' ? parsed.sentenceRhythm : undefined,
      interiority:    typeof parsed.interiority === 'string'    ? parsed.interiority    : undefined,
      dialogueWeight: typeof parsed.dialogueWeight === 'string' ? parsed.dialogueWeight : undefined,
      devices:        Array.isArray(parsed.devices) ? parsed.devices.filter((d: unknown) => typeof d === 'string') : [],
      rules:          Array.isArray(parsed.rules)   ? parsed.rules.filter((r: unknown) => typeof r === 'string')   : [],
      antiPatterns:   Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
    };
  } catch {
    return null;
  }
}

function exportProfileJson(name: string, profile: ProseProfile): string {
  return JSON.stringify({ name, ...profile }, null, 2);
}

function newSavedProfileId(): string {
  return `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function draftToProfile(d: Draft): ProseProfile {
  return {
    register:       d.register || 'conversational',
    stance:         d.stance   || 'close_third',
    tense:          d.tense          || undefined,
    sentenceRhythm: d.sentenceRhythm || undefined,
    interiority:    d.interiority    || undefined,
    dialogueWeight: d.dialogueWeight || undefined,
    devices:        d.devices,
    rules:          d.rules,
    antiPatterns:   d.antiPatterns,
  };
}

// ── Template for external LLM extraction ──────────────────────────────────────

const PROSE_PROFILE_TEMPLATE = `Analyze the prose sample below and fill in this JSON template:

{
  "register": "[FILL: tonal register — e.g. 'literary', 'conversational', 'clinical detached observer', 'lyrical', 'terse hardboiled']",
  "stance": "[FILL: narrator distance — e.g. 'close third', 'omniscient', 'deep first', 'distant third']",
  "tense": "[FILL: grammatical tense — e.g. 'past', 'present', 'mixed']",
  "sentenceRhythm": "[FILL: structural cadence — e.g. 'varied with short punches', 'long flowing periods', 'staccato', 'balanced']",
  "interiority": "[FILL: what the POV's interior is made of]",
  "dialogueWeight": "[FILL: proportion of dialogue]",
  "devices": ["[FILL: rhetorical/narrative devices]"],
  "rules": ["[FILL: show-don't-tell constraints]"],
  "antiPatterns": ["[FILL: specific prose failures to avoid]"]
}

PROSE SAMPLE:
---
[PASTE YOUR PROSE SAMPLE HERE]
---

Return ONLY the filled JSON — no explanation needed.`;

// ── Component ─────────────────────────────────────────────────────────────────

/** Are two profiles equal in every persisted field? */
function profilesEqual(a: ProseProfile | undefined, b: ProseProfile | undefined): boolean {
  if (!a || !b) return a === b;
  for (const f of STRING_FIELDS) {
    if ((a[f] ?? '') !== (b[f] ?? '')) return false;
  }
  for (const k of ['devices', 'rules', 'antiPatterns'] as const) {
    const av = [...(a[k] ?? [])].sort();
    const bv = [...(b[k] ?? [])].sort();
    if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
  }
  return true;
}

export default function ProseProfilePanel({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const current = narrative?.proseProfile;
  const saved: SavedProseProfile[] = narrative?.savedProseProfiles ?? [];
  const presets = BEAT_PROFILE_PRESETS;

  const [draft, setDraft] = useState<Draft>(() => toDraft(current ?? {}));
  const [appliedKey, setAppliedKey] = useState<string | null>(() => detectPresetKey(current, presets));
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [exportedId, setExportedId] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(toDraft(current ?? {})); setSelectedSavedId(null); }, [narrative?.id]);

  // Auto-seed the library on first open. New narratives start with one saved
  // profile (their current active, or the Storyteller default) so management
  // always has at least one anchor to work from.
  useEffect(() => {
    if (!narrative) return;
    if ((narrative.savedProseProfiles?.length ?? 0) > 0) return;
    const seedProfile = narrative.proseProfile
      ?? presets.find((p) => p.key === 'storyteller')?.profile
      ?? presets[0]?.profile;
    if (!seedProfile) return;
    const seedName = (() => {
      const matchedPreset = presets.find((p) => profilesEqual(p.profile, seedProfile));
      return matchedPreset?.name ?? 'Default';
    })();
    dispatch({
      type: 'ADD_SAVED_PROSE_PROFILE',
      saved: { id: newSavedProfileId(), name: seedName, profile: seedProfile, createdAt: Date.now() },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrative?.id]);

  if (!narrative) return null;

  // Which library item (if any) matches the narrative's current active profile?
  const activeSavedId = current ? saved.find((s) => profilesEqual(s.profile, current))?.id ?? null : null;
  const activeWorkKey = current ? presets.find((p) => profilesEqual(p.profile, current))?.key ?? null : null;

  const draftProfile = draftToProfile(draft);
  const draftMatchesActive = profilesEqual(draftProfile, current);

  function setField<K extends keyof Draft>(key: K, val: Draft[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: val };
      setAppliedKey(detectPresetKey(next, presets));
      return next;
    });
  }

  function loadPreset(key: string, profile: ProseProfile) {
    setDraft(toDraft(profile));
    setAppliedKey(key);
    setSelectedSavedId(null);
    setMode('edit');
  }

  function loadProfile(profile: ProseProfile) {
    setDraft(toDraft(profile));
    setAppliedKey(detectPresetKey(profile, presets));
    setSelectedSavedId(null);
    setMode('edit');
  }

  function loadSaved(s: SavedProseProfile) {
    setDraft(toDraft(s.profile));
    setAppliedKey(null);
    setSelectedSavedId(s.id);
    setMode('edit');
  }

  function commitSaveAs() {
    const name = saveName.trim();
    if (!name) return;
    const id = newSavedProfileId();
    dispatch({
      type: 'ADD_SAVED_PROSE_PROFILE',
      saved: { id, name, profile: draftProfile, createdAt: Date.now() },
    });
    setSelectedSavedId(id);
    setSavePrompt(false);
    setSaveName('');
  }

  function duplicateSaved(s: SavedProseProfile) {
    const id = newSavedProfileId();
    dispatch({
      type: 'ADD_SAVED_PROSE_PROFILE',
      saved: { id, name: `${s.name} (copy)`, profile: s.profile, createdAt: Date.now() },
    });
    setRenamingId(id);
    setRenameValue(`${s.name} (copy)`);
  }

  function copyWorkToLibrary(p: BeatProfilePreset) {
    const id = newSavedProfileId();
    dispatch({
      type: 'ADD_SAVED_PROSE_PROFILE',
      saved: { id, name: p.name, profile: p.profile, createdAt: Date.now() },
    });
    setSelectedSavedId(id);
    loadSaved({ id, name: p.name, profile: p.profile, createdAt: Date.now() });
  }

  function exportSaved(s: SavedProseProfile) {
    navigator.clipboard.writeText(exportProfileJson(s.name, s.profile));
    setExportedId(s.id);
    setTimeout(() => setExportedId((curr) => (curr === s.id ? null : curr)), 1500);
  }

  function commitRename(id: string) {
    const name = renameValue.trim();
    if (name) dispatch({ type: 'RENAME_SAVED_PROSE_PROFILE', id, name });
    setRenamingId(null);
    setRenameValue('');
  }

  function setActiveProfile(p: ProseProfile) {
    dispatch({ type: 'SET_PROSE_PROFILE', profile: p });
  }

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="90vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Prose Profile</h2>
          <p className="text-xs text-text-dim">Voice and style applied to all prose generation</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        <div className="flex min-h-0" style={{ minHeight: 560 }}>

          {/* ── Sidebar ── */}
          <aside className="w-52 shrink-0 border-r border-white/6 p-2.5 flex flex-col gap-0.5 overflow-y-auto">

            {/* Saved profiles */}
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-[10px] uppercase tracking-widest font-medium text-text-dim">Saved</span>
              <button
                onClick={() => { setSavePrompt(true); setSaveName(''); }}
                title="Save current draft as a new profile"
                className="text-[13px] text-text-dim hover:text-violet-300 transition-colors"
              >
                + Save as
              </button>
            </div>

            {savePrompt && (
              <div className="flex gap-1 mb-1 px-0.5">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSaveAs();
                    if (e.key === 'Escape') { setSavePrompt(false); setSaveName(''); }
                  }}
                  placeholder="Profile name…"
                  className="flex-1 min-w-0 bg-white/4 border border-white/10 rounded px-1.5 py-0.5 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-violet-500/40"
                />
                <button onClick={commitSaveAs} className="text-[13px] text-violet-300 hover:text-violet-200 px-1">Save</button>
              </div>
            )}

            {saved.length === 0 && !savePrompt && (
              <p className="text-[13px] text-text-dim/60 italic px-1 mb-2">No saved profiles yet.</p>
            )}

            {saved.map((s) => {
              const isSelected = selectedSavedId === s.id;
              const isActive = activeSavedId === s.id;
              const isRenaming = renamingId === s.id;
              const isConfirming = confirmDeleteId === s.id;
              return (
                <div
                  key={s.id}
                  className={`group relative rounded-md transition-colors ${
                    isSelected ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent hover:bg-white/4'
                  }`}
                >
                  {isRenaming ? (
                    <div className="px-2 py-1.5 flex gap-1">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(s.id);
                          if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                        }}
                        className="flex-1 min-w-0 bg-white/4 border border-white/10 rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-violet-500/40"
                      />
                      <button onClick={() => commitRename(s.id)} className="text-[13px] text-violet-300 hover:text-violet-200">OK</button>
                    </div>
                  ) : isConfirming ? (
                    <div className="px-2 py-1.5 flex items-center justify-between gap-1">
                      <span className="text-xs text-text-secondary truncate">Delete?</span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => { dispatch({ type: 'DELETE_SAVED_PROSE_PROFILE', id: s.id }); setConfirmDeleteId(null); if (selectedSavedId === s.id) setSelectedSavedId(null); }}
                          className="text-[13px] text-red-400 hover:text-red-300"
                        >
                          Yes
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[13px] text-text-dim hover:text-text-secondary">No</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => loadSaved(s)}
                        className="w-full text-left px-2 py-1.5 flex flex-col gap-0"
                      >
                        <div className="flex items-center gap-1.5">
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Currently active" />}
                          <span className={`text-[13px] font-medium leading-tight truncate ${isSelected ? 'text-violet-300' : 'text-text-secondary'}`}>{s.name}</span>
                        </div>
                        <span className="text-[13px] text-text-dim leading-snug truncate">
                          {s.profile.register} · {s.profile.stance.replace(/_/g, ' ')}
                        </span>
                      </button>
                      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconBtn title="Duplicate"       onClick={() => duplicateSaved(s)} symbol="⎘+" />
                        <IconBtn title="Rename"          onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }} symbol="✎" />
                        <IconBtn title={exportedId === s.id ? 'Copied' : 'Export JSON'} onClick={() => exportSaved(s)} symbol={exportedId === s.id ? '✓' : '⎘'} highlight={exportedId === s.id} />
                        <IconBtn title="Delete"          onClick={() => setConfirmDeleteId(s.id)} symbol="×" danger />
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Built-in / works */}
            <span className="text-[10px] uppercase tracking-widest font-medium text-text-dim px-1 mt-3 mb-1">Works</span>
            {presets.map((p) => {
              const isSelected = appliedKey === p.key && selectedSavedId === null && mode === 'edit';
              const isActive = activeWorkKey === p.key;
              return (
                <div
                  key={p.key}
                  className={`group relative rounded-md transition-colors ${
                    isSelected ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent hover:bg-white/4'
                  }`}
                >
                  <button
                    onClick={() => loadPreset(p.key, p.profile)}
                    className="w-full text-left px-2 py-1.5 flex flex-col gap-0"
                  >
                    <div className="flex items-center gap-1.5">
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Currently active" />}
                      <span className={`text-[13px] font-medium leading-tight truncate ${isSelected ? 'text-violet-300' : 'text-text-secondary'}`}>{p.name}</span>
                    </div>
                    <span className="text-[13px] text-text-dim leading-snug truncate">{p.description}</span>
                  </button>
                  <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconBtn title="Copy to library" onClick={() => copyWorkToLibrary(p)} symbol="⎘+" />
                  </div>
                </div>
              );
            })}

            {/* Tools */}
            <span className="text-[10px] uppercase tracking-widest font-medium text-text-dim px-1 mt-3 mb-1">Tools</span>
            <SidebarToolButton active={mode === 'text'}  label="Refine / Import" hint="Update from text, notes, or JSON" onClick={() => setMode('text')} />
            <SidebarToolButton active={mode === 'taste'} label="Blind taste test" hint="Compare voices side by side" onClick={() => setMode('taste')} />
          </aside>

          {/* ── Main area ── */}
          {mode === 'edit'  && <EditView draft={draft} setField={setField} presets={presets} />}
          {mode === 'text'  && <TextView draft={draft} apply={loadProfile} template={PROSE_PROFILE_TEMPLATE} />}
          {mode === 'taste' && <TasteTestView draft={draft} presets={presets} saved={saved} onApply={loadProfile} />}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-2.5 border-t border-white/6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {selectedSavedId && !draftMatchesActive && (
              <button
                onClick={() => dispatch({ type: 'UPDATE_SAVED_PROSE_PROFILE', id: selectedSavedId, profile: draftProfile })}
                className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-text-dim hover:text-violet-300 hover:border-violet-500/30 transition-colors"
                title="Save current edits back to this saved profile"
              >
                Update saved
              </button>
            )}
            {draftMatchesActive
              ? <span className="text-xs text-emerald-400/80 italic truncate">● Active matches current draft</span>
              : <span className="text-xs text-text-dim/70 italic truncate">Unsaved edits — &ldquo;Set as active&rdquo; to apply to generation.</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] text-text-dim hover:text-text-secondary transition-colors">
              Close
            </button>
            <button
              onClick={() => setActiveProfile(draftProfile)}
              disabled={draftMatchesActive}
              className="px-3 py-1.5 rounded-md border border-violet-500/40 text-[13px] text-violet-200 hover:bg-violet-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Make the current draft the narrative's active profile (used by prose generation)"
            >
              Set as active
            </button>
            <button onClick={() => { setActiveProfile(draftProfile); onClose(); }}
              className="px-5 py-1.5 rounded-md bg-violet-600/80 hover:bg-violet-500/80 text-[13px] text-white font-medium transition-colors">
              Set active &amp; close
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

function IconBtn({ title, onClick, symbol, danger, highlight }: {
  title: string; onClick: () => void; symbol: string; danger?: boolean; highlight?: boolean;
}) {
  const tone = highlight
    ? 'text-violet-300'
    : danger
      ? 'text-text-dim hover:text-red-400'
      : 'text-text-dim hover:text-text-primary';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`w-5 h-5 flex items-center justify-center text-[13px] leading-none rounded hover:bg-white/8 transition-colors ${tone}`}
    >
      {symbol}
    </button>
  );
}

// ── Sidebar tool button ──────────────────────────────────────────────────────

function SidebarToolButton({ active, label, hint, onClick }: {
  active: boolean; label: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-md px-2 py-1.5 transition-colors flex flex-col gap-0 ${
        active ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent hover:bg-white/4'
      }`}
    >
      <span className={`text-[13px] font-medium leading-tight ${active ? 'text-violet-300' : 'text-text-secondary'}`}>{label}</span>
      <span className="text-[13px] text-text-dim leading-snug truncate">{hint}</span>
    </button>
  );
}

// ── Edit view ────────────────────────────────────────────────────────────────

function EditView({ draft, setField, presets }: {
  draft: Draft;
  setField: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  presets: BeatProfilePreset[];
}) {
  const deviceOptions = useMemo(() => deriveDeviceOptions(presets), [presets]);
  const ruleTemplates = useMemo(() => deriveTemplates(presets, 'rules'), [presets]);
  const antiPatternTemplates = useMemo(() => deriveTemplates(presets, 'antiPatterns'), [presets]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {STRING_FIELDS.map((field) => (
          <SuggestionField
            key={field}
            label={FIELD_LABELS[field]}
            value={draft[field]}
            options={deriveOptions(presets, field)}
            onChange={(v) => setField(field, v)}
          />
        ))}

        <div className="col-span-2">
          <FieldLabel>Devices</FieldLabel>
          <TagField
            values={draft.devices}
            options={deviceOptions}
            placeholder="Add device…"
            onChange={(v) => setField('devices', v)}
          />
        </div>

        <ListField
          label="Rules"
          tone="violet"
          emptyMessage="No rules set"
          values={draft.rules}
          templates={ruleTemplates}
          placeholder="Add rule…"
          onChange={(v) => setField('rules', v)}
        />

        <ListField
          label="Anti-patterns"
          tone="red"
          emptyMessage="No anti-patterns set"
          values={draft.antiPatterns}
          templates={antiPatternTemplates}
          placeholder="Add anti-pattern…"
          onChange={(v) => setField('antiPatterns', v)}
        />
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-widest font-medium text-text-dim block mb-1.5">{children}</span>;
}

// ── Refine / Import view ─────────────────────────────────────────────────────

function TextView({ draft, apply, template }: { draft: Draft; apply: (p: ProseProfile) => void; template: string }) {
  const hasDraft = !!(draft.register || draft.stance || draft.devices.length > 0 || draft.rules.length > 0);
  const [intent, setIntent] = useState<'refine' | 'replace'>(hasDraft ? 'refine' : 'replace');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const jsonPayload = useMemo(() => tryParseProfileJson(text), [text]);

  async function run() {
    if (!text.trim() || busy) return;

    // Short-circuit: paste a literal exported profile JSON → apply directly.
    if (jsonPayload) {
      apply(jsonPayload);
      setText('');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const profile = intent === 'refine'
        ? await refineProseProfile(draftToProfile(draft), text)
        : await ingestProseProfile(text, intent === 'replace' ? undefined : draft);
      apply(profile);
      setText('');
    } catch {
      setError('Extraction failed. Try again or paste a shorter sample.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-[12px] font-semibold text-text-secondary mb-0.5">Update from text</h3>
          <p className="text-xs text-text-dim leading-relaxed">
            Paste prose, editorial notes, or a natural-language instruction (e.g. <span className="text-text-dim/80 italic">&ldquo;more clinical, drop the adverbs rule&rdquo;</span>).
          </p>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(template); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="shrink-0 text-xs px-2.5 py-1 rounded-md border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/20 transition-all"
        >
          {copied ? 'Copied' : 'Copy template'}
        </button>
      </div>

      <div className="flex items-center gap-1 mb-3 p-0.5 rounded-md bg-white/3 border border-white/6 w-fit">
        <IntentTab active={intent === 'refine'}  disabled={!hasDraft} onClick={() => setIntent('refine')}  label="Refine current" hint="Keep what you have; tweak what the text touches" />
        <IntentTab active={intent === 'replace'} onClick={() => setIntent('replace')} label="Replace" hint="Start fresh from text" />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={intent === 'refine'
          ? 'e.g. "Make it more clinical, drop the deep_immersion interiority, add a rule against -ly adverbs." Or paste a sample to match.'
          : 'Paste a prose sample or style guide…'}
        disabled={busy}
        className="w-full flex-1 bg-white/3 border border-white/8 rounded-md px-3 py-2 text-[13px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors resize-none leading-relaxed disabled:opacity-50"
      />

      {error && <p className="text-xs text-red-400/90 mt-2">{error}</p>}

      <div className="flex items-center justify-between mt-3 gap-3">
        {jsonPayload ? (
          <span className="text-xs text-violet-300">Exported profile detected — will import directly, no AI call.</span>
        ) : (
          <span className="text-xs text-text-dim/60">Tip: paste exported profile JSON to import directly.</span>
        )}
        <button
          onClick={run}
          disabled={!text.trim() || busy}
          className="text-xs px-4 py-1.5 rounded-md bg-violet-600/80 hover:bg-violet-500/80 text-white font-medium disabled:opacity-25 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {busy
            ? (intent === 'refine' ? 'Refining…' : 'Extracting…')
            : jsonPayload
              ? 'Import profile'
              : intent === 'refine'
                ? 'Refine profile'
                : 'Extract profile'}
        </button>
      </div>
    </div>
  );
}

function IntentTab({ active, disabled, onClick, label, hint }: {
  active: boolean; disabled?: boolean; onClick: () => void; label: string; hint: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'No current profile to refine' : hint}
      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-violet-500/20 text-violet-200' : 'text-text-dim hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
  );
}

// ── Taste test view ──────────────────────────────────────────────────────────

type TasteCandidate = { key: string; name: string; profile: ProseProfile };
type SampleResult = { candidateKey: string; prose: string; error?: string };

function TasteTestView({ draft, presets, saved, onApply }: {
  draft: Draft;
  presets: BeatProfilePreset[];
  saved: SavedProseProfile[];
  onApply: (p: ProseProfile) => void;
}) {
  const draftProfile = draftToProfile(draft);

  const allCandidates: TasteCandidate[] = useMemo(() => {
    const out: TasteCandidate[] = [];
    if (draft.register || draft.stance) out.push({ key: '__draft__', name: 'Current draft', profile: draftProfile });
    for (const s of saved) out.push({ key: s.id, name: s.name, profile: s.profile });
    for (const p of presets) out.push({ key: p.key, name: p.name, profile: p.profile });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, saved, draft.register, draft.stance, draft.devices.length, draft.rules.length, draft.tense, draft.sentenceRhythm, draft.interiority, draft.dialogueWeight]);

  const [selected, setSelected] = useState<string[]>(() => {
    const initial = allCandidates.slice(0, Math.min(3, allCandidates.length)).map((c) => c.key);
    return initial;
  });
  const [paradigmFilter, setParadigmFilter] = useState<TasteTestSeedParadigm | 'all'>('all');
  const [seedIdx, setSeedIdx] = useState(0);
  const [customMode, setCustomMode] = useState(false);
  const [customSeed, setCustomSeed] = useState('');
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState<SampleResult[] | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  const filteredSeeds = useMemo(
    () => paradigmFilter === 'all' ? TASTE_TEST_SEEDS : TASTE_TEST_SEEDS.filter((s) => s.paradigm === paradigmFilter),
    [paradigmFilter]
  );

  const activeSeed = customMode
    ? { category: 'Custom', paradigm: 'agnostic' as const, prompt: customSeed }
    : filteredSeeds[seedIdx % Math.max(1, filteredSeeds.length)];

  function toggle(key: string) {
    setSelected((s) => {
      if (s.includes(key)) return s.filter((k) => k !== key);
      if (s.length >= 4) return s;
      return [...s, key];
    });
  }

  async function run() {
    if (selected.length < 2 || running) return;
    const seedPrompt = activeSeed?.prompt?.trim();
    if (!seedPrompt) return;
    setRunning(true);
    setSamples(null);
    setRevealed(false);
    setPicked(null);
    const chosen = selected.map((k) => allCandidates.find((c) => c.key === k)!).filter(Boolean);
    const results = await Promise.all(
      chosen.map(async (c): Promise<SampleResult> => {
        try {
          const prose = await generateProseSample(c.profile, seedPrompt);
          return { candidateKey: c.key, prose };
        } catch {
          return { candidateKey: c.key, prose: '', error: 'Failed to generate' };
        }
      })
    );
    const indices = results.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setSamples(results);
    setOrder(indices);
    setRunning(false);
  }

  const chosen = selected.map((k) => allCandidates.find((c) => c.key === k)!).filter(Boolean);

  const paradigmOptions: { value: TasteTestSeedParadigm | 'all'; label: string }[] = [
    { value: 'all',         label: 'All paradigms' },
    { value: 'fiction',     label: 'Fiction' },
    { value: 'simulation',  label: 'Simulation' },
    { value: 'essay',       label: 'Essay' },
    { value: 'panel',       label: 'Panel' },
    { value: 'atlas',       label: 'Atlas' },
    { value: 'debate',      label: 'Debate' },
    { value: 'record',      label: 'Record' },
    { value: 'non-fiction', label: 'Non-fiction' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <div>
        <h3 className="text-[12px] font-semibold text-text-secondary mb-0.5">Blind taste test</h3>
        <p className="text-xs text-text-dim leading-relaxed">
          Pick 2–4 profiles. Same seed scenario across all of them — voice carries the difference. Samples are anonymised until you choose.
        </p>
      </div>

      {/* ── Profile selection ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <FieldLabel>Profiles to compare</FieldLabel>
          <span className="text-[13px] text-text-dim">{selected.length}/4</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allCandidates.map((c) => {
            const isSelected = selected.includes(c.key);
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors leading-none ${
                  isSelected
                    ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                    : 'border-white/8 text-text-dim hover:border-white/20 hover:text-text-secondary'
                }`}
              >
                {isSelected ? '✓ ' : ''}{c.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Seed scenario ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <FieldLabel>Seed scenario · controlled</FieldLabel>
          <span className="text-[11px] text-text-dim">Same content across every sample &mdash; voice carries the difference.</span>
        </div>

        {/* Paradigm + custom toggle row */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            value={customMode ? '__custom__' : paradigmFilter}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') { setCustomMode(true); }
              else { setCustomMode(false); setParadigmFilter(v as TasteTestSeedParadigm | 'all'); setSeedIdx(0); }
            }}
            className="bg-white/4 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-violet-500/40"
          >
            {paradigmOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            <option value="__custom__">Custom seed…</option>
          </select>

          {!customMode && filteredSeeds.length > 0 && (
            <>
              <select
                value={seedIdx % filteredSeeds.length}
                onChange={(e) => setSeedIdx(Number(e.target.value))}
                className="flex-1 min-w-0 bg-white/4 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-violet-500/40"
              >
                {filteredSeeds.map((s, i) => (
                  <option key={i} value={i}>{s.category}</option>
                ))}
              </select>
              <span className="text-[11px] text-text-dim shrink-0">
                {(seedIdx % filteredSeeds.length) + 1}/{filteredSeeds.length}
              </span>
              <button
                onClick={() => setSeedIdx((i) => (i + 1) % filteredSeeds.length)}
                className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/20 transition-colors"
                title="Next seed"
              >
                Next
              </button>
            </>
          )}

          {customMode && (
            <span className="text-[11px] text-violet-300/80">Write your own scenario below.</span>
          )}
        </div>

        {/* Seed body */}
        {customMode ? (
          <textarea
            value={customSeed}
            onChange={(e) => setCustomSeed(e.target.value)}
            rows={6}
            placeholder={'Use structured tags for tight comparison, e.g.\nCHARACTER: …\nSETTING: …\nACTION: …\nEVENT / OBSERVATION: …\n\nTags are not required, but pinning the character, setting, and load-bearing detail keeps voice as the only variable.'}
            className="w-full bg-white/3 border border-white/8 rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-dim/40 outline-none focus:border-violet-500/40 transition-colors resize-y leading-relaxed"
          />
        ) : (
          <div className="px-3 py-2 rounded-md bg-white/3 border border-white/6 space-y-1">
            {activeSeed.prompt.split(/\s(?=[A-Z][A-Z\- ]+:)/).map((line, i) => {
              const colon = line.indexOf(':');
              const tag = colon > 0 ? line.slice(0, colon) : '';
              if (!tag || !/^[A-Z][A-Z\- ]+$/.test(tag)) {
                return <p key={i} className="text-xs text-text-secondary leading-snug">{line}</p>;
              }
              return (
                <p key={i} className="text-xs leading-snug">
                  <span className="text-violet-300/80 font-medium tracking-wide">{tag}</span>
                  <span className="text-text-secondary"> &nbsp;{line.slice(colon + 1).trim()}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Run ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={selected.length < 2 || running || !activeSeed.prompt.trim()}
          className="text-xs px-4 py-1.5 rounded-md bg-violet-600/80 hover:bg-violet-500/80 text-white font-medium disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
        >
          {running ? 'Writing samples…' : samples ? 'Run again' : `Generate ${selected.length || ''} samples`}
        </button>
        {customMode && !customSeed.trim() && (
          <span className="text-[11px] text-text-dim italic">Write a seed scenario above to enable the test.</span>
        )}
      </div>

      {/* ── Samples / results ── */}
      {running && <SampleSkeletons count={selected.length} />}

      {samples && !running && (
        <div className="space-y-3">
          {order.map((origIdx, displayIdx) => {
            const result = samples[origIdx];
            const candidate = chosen.find((c) => c.key === result.candidateKey)!;
            const letter = String.fromCharCode(65 + displayIdx);
            const isPicked = picked === origIdx;
            return (
              <SampleCard
                key={result.candidateKey}
                letter={letter}
                prose={result.prose}
                error={result.error}
                revealedName={revealed ? candidate.name : null}
                picked={isPicked}
                onPick={() => setPicked(origIdx)}
              />
            );
          })}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!revealed && picked !== null && (
              <button
                onClick={() => setRevealed(true)}
                className="text-xs px-3 py-1.5 rounded-md bg-violet-600/80 hover:bg-violet-500/80 text-white font-medium transition-colors"
              >
                Reveal
              </button>
            )}
            {revealed && picked !== null && (() => {
              const result = samples[picked];
              const candidate = chosen.find((c) => c.key === result.candidateKey)!;
              return (
                <button
                  onClick={() => onApply(candidate.profile)}
                  className="text-xs px-3 py-1.5 rounded-md bg-violet-600/80 hover:bg-violet-500/80 text-white font-medium transition-colors"
                >
                  Apply &ldquo;{candidate.name}&rdquo;
                </button>
              );
            })()}
            {picked === null && samples.length > 0 && (
              <span className="text-xs text-text-dim italic">Pick the sample you like best.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SampleCard({ letter, prose, error, revealedName, picked, onPick }: {
  letter: string;
  prose: string;
  error?: string;
  revealedName: string | null;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={`w-full text-left rounded-md p-3 border transition-colors ${
        picked
          ? 'border-violet-500/50 bg-violet-500/8'
          : 'border-white/8 bg-white/2 hover:border-white/15 hover:bg-white/4'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <div className="flex items-baseline gap-2">
          <span className={`text-xs font-bold tracking-wider ${picked ? 'text-violet-300' : 'text-text-secondary'}`}>SAMPLE {letter}</span>
          {revealedName && <span className="text-xs text-text-dim italic">— {revealedName}</span>}
        </div>
        {picked && <span className="text-[13px] text-violet-300 uppercase tracking-wider">picked</span>}
      </div>
      {error
        ? <p className="text-xs text-red-400/80">{error}</p>
        : <p className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">{prose}</p>
      }
    </button>
  );
}

function SampleSkeletons({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md p-3 border border-white/8 bg-white/2 animate-pulse">
          <div className="h-2.5 w-20 rounded bg-white/5 mb-2" />
          <div className="space-y-1.5">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-2 rounded bg-white/5" style={{ width: `${60 + Math.random() * 35}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ListField (rules / anti-patterns) ────────────────────────────────────────

function ListField({ label, tone, emptyMessage, values, templates, placeholder, onChange }: {
  label: string;
  tone: 'violet' | 'red';
  emptyMessage: string;
  values: string[];
  templates: string[];
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const borderClass = tone === 'violet' ? 'border-violet-500/30' : 'border-red-500/30';

  function add(t: string) {
    const v = t.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  }

  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between mb-1.5">
        <FieldLabel>{label}</FieldLabel>
        {templates.length > 0 && (
          <button onClick={() => setShowTemplates((v) => !v)} className="text-[13px] text-text-dim hover:text-text-secondary transition-colors">
            {showTemplates ? 'Hide templates' : 'From works'}
          </button>
        )}
      </div>

      {showTemplates && (
        <div className="flex flex-col gap-0.5 mb-2 p-2 rounded-md bg-white/2 border border-white/5 max-h-32 overflow-y-auto">
          {templates.filter((t) => !values.includes(t)).map((t) => (
            <button key={t} onClick={() => add(t)}
              className="text-left text-[13px] text-text-dim hover:text-text-secondary transition-colors py-0.5">
              + {t}
            </button>
          ))}
        </div>
      )}

      {values.length > 0 && (
        <div className="space-y-1 mb-2">
          {values.map((r, i) => (
            <div key={i} className="flex items-start gap-2 group">
              <span className={`flex-1 text-xs text-text-secondary leading-snug pl-2 border-l ${borderClass} py-0.5`}>{r}</span>
              <button onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-text-primary transition-opacity mt-0.5 shrink-0 text-xs">×</button>
            </div>
          ))}
        </div>
      )}

      {values.length === 0 && (
        <p className="text-xs text-text-dim italic mb-2">{emptyMessage}</p>
      )}

      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(input); }}
          placeholder={placeholder}
          className="flex-1 bg-white/4 border border-white/8 rounded-md px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20" />
        <button onClick={() => add(input)} className="px-3 rounded-md border border-white/10 text-xs text-text-secondary hover:text-text-primary transition-colors">Add</button>
      </div>
    </div>
  );
}

// ── SuggestionField ───────────────────────────────────────────────────────────

function SuggestionField({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; sources: string[] }[];
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const isKnown = options.some((o) => o.value === value);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (isKnown) setCustom(''); }, [isKnown, value]);

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>

      <div className="flex flex-wrap gap-1 mb-1.5">
        {!isKnown && value.trim() && (
          <span className="px-2 py-0.5 rounded-full text-xs border border-violet-500/50 bg-violet-500/10 text-violet-300 leading-none">
            {value.replace(/_/g, ' ')}
          </span>
        )}
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => { onChange(o.value); setCustom(''); }}
            title={o.sources.join(', ')}
            className={`px-2 py-0.5 rounded-full text-xs border transition-colors leading-none ${
              value === o.value
                ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                : 'border-white/8 text-text-dim hover:border-white/20 hover:text-text-secondary'
            }`}
          >
            {o.value.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={isKnown ? '' : (custom || value)}
        onChange={(e) => { setCustom(e.target.value); if (e.target.value.trim()) onChange(e.target.value.trim()); }}
        onBlur={() => { if (!custom.trim()) setCustom(''); }}
        placeholder={isKnown ? `${value.replace(/_/g, ' ')} — or type to override` : 'Custom value…'}
        className={`w-full rounded-md px-2.5 py-1 text-xs border focus:outline-none transition-colors ${
          !isKnown && value
            ? 'bg-violet-500/5 border-violet-500/30 text-violet-300 placeholder:text-violet-400/40 focus:border-violet-500/50'
            : 'bg-white/3 border-white/6 text-text-dim placeholder:text-text-dim/40 focus:border-white/15 focus:text-text-secondary'
        }`}
      />
    </div>
  );
}

// ── TagField ──────────────────────────────────────────────────────────────────

function TagField({ values, options, placeholder, onChange }: {
  values: string[];
  options: { value: string; sources: string[] }[];
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  function add(v: string) {
    const t = v.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setInput('');
  }

  const unselected = options.filter((o) => !values.includes(o.value));

  return (
    <div ref={ref}>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-500/40 bg-violet-500/8 text-xs text-violet-300 leading-none">
              {v.replace(/_/g, ' ')}
              <button onClick={() => onChange(values.filter((x) => x !== v))} className="opacity-60 hover:opacity-100 leading-none ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}

      {unselected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {unselected.map((o) => (
            <button
              key={o.value}
              onClick={() => add(o.value)}
              title={o.sources.join(', ')}
              className="px-2 py-0.5 rounded-full text-xs border border-white/8 text-text-dim hover:border-white/20 hover:text-text-secondary transition-colors leading-none"
            >
              + {o.value.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(input); }}
        placeholder={placeholder}
        className="w-full bg-white/4 border border-white/8 rounded-md px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20"
      />
    </div>
  );
}
