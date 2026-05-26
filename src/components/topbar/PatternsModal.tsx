'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Modal, ModalHeader, ModalBody, ModalFooter, StreamingStatus } from '@/components/Modal';
import { detectPatterns } from '@/lib/ai';
import { IconRefresh } from '@/components/icons';
import type { NarrativeParadigm } from '@/types/narrative';

const PARADIGMS: { value: NarrativeParadigm; label: string; hint: string }[] = [
  { value: 'fiction',     label: 'Fiction',     hint: 'Invented people in an invented world' },
  { value: 'non-fiction', label: 'Non-fiction', hint: 'Real people, documented events — the world IS the record' },
  { value: 'simulation',  label: 'Simulation',  hint: 'Rule-driven forward modelling — the rules force what happens' },
  { value: 'essay',       label: 'Essay',       hint: 'One named author working an argument' },
  { value: 'panel',       label: 'Panel',       hint: 'A named cast (AI or human) deliberating over evidence' },
  { value: 'atlas',       label: 'Atlas',       hint: 'Reference / typology — entries, taxa, doctrines' },
  { value: 'debate',      label: 'Debate',      hint: 'Two or more parties in a zero-sum contest under rules' },
  { value: 'record',      label: 'Record',      hint: 'Time-ordered chronicle — daily, monthly, yearly, or dynamic velocity' },
];

type Props = {
  onClose: () => void;
};

function CommandmentList({
  title,
  description,
  items,
  onAdd,
  onRemove,
  onReplace,
  placeholder,
  accentColor,
}: {
  title: string;
  description: string;
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (index: number) => void;
  onReplace: (items: string[]) => void;
  placeholder: string;
  accentColor: 'emerald' | 'red' | 'blue';
}) {
  const [newItem, setNewItem] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (trimmed && !items.includes(trimmed)) {
      onAdd(trimmed);
      setNewItem('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(items[index]);
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && editingText.trim()) {
      const updated = [...items];
      updated[editingIndex] = editingText.trim();
      onReplace(updated);
    }
    setEditingIndex(null);
    setEditingText('');
  };

  const colorMap = {
    emerald: {
      border: 'border-emerald-500/20',
      bg: 'bg-emerald-500/5',
      text: 'text-emerald-400',
      hover: 'hover:bg-emerald-500/10',
    },
    red: {
      border: 'border-red-500/20',
      bg: 'bg-red-500/5',
      text: 'text-red-400',
      hover: 'hover:bg-red-500/10',
    },
    blue: {
      border: 'border-blue-500/20',
      bg: 'bg-blue-500/5',
      text: 'text-blue-400',
      hover: 'hover:bg-blue-500/10',
    },
  };

  const colors = colorMap[accentColor];

  return (
    <div className="space-y-3">
      <div>
        <h3 className={`text-[12px] font-medium ${colors.text}`}>{title}</h3>
        <p className="text-[10px] text-text-dim mt-0.5">{description}</p>
      </div>

      {/* Existing items */}
      <div className={`border ${colors.border} rounded-lg ${colors.bg} overflow-hidden`}>
        {items.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-dim/50">
            No commandments yet
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((item, index) => (
              <li key={index} className="flex items-start gap-2 px-3 py-2 group">
                {editingIndex === index ? (
                  <div className="flex-1 flex gap-2">
                    <input
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') {
                          setEditingIndex(null);
                          setEditingText('');
                        }
                      }}
                      className="flex-1 bg-bg-elevated border border-white/20 rounded px-2 py-1 text-[11px] text-text-primary outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="px-2 py-1 rounded bg-white/10 text-[10px] text-text-primary hover:bg-white/15"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <>
                    <span
                      className="text-[11px] text-text-secondary leading-relaxed flex-1 cursor-pointer hover:text-text-primary transition-colors"
                      onClick={() => handleEdit(index)}
                      title="Click to edit"
                    >
                      {item}
                    </span>
                    <button
                      onClick={() => onRemove(index)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 hover:bg-white/5 transition-all shrink-0"
                      title="Remove"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={!newItem.trim()}
          className={`px-3 py-2 rounded-lg border ${colors.border} ${colors.bg} ${colors.text} ${colors.hover} text-[11px] font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function PatternsModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const [paradigm, setParadigm] = useState<NarrativeParadigm | undefined>(narrative?.paradigm);
  const [genre, setGenre] = useState<string>(narrative?.genre ?? '');
  const [subgenre, setSubgenre] = useState<string>(narrative?.subgenre ?? '');
  const [patterns, setPatterns] = useState<string[]>(narrative?.patterns ?? []);
  const [antiPatterns, setAntiPatterns] = useState<string[]>(narrative?.antiPatterns ?? []);

  const [detecting, setDetecting] = useState(false);
  const [streamText, setStreamText] = useState('');

  const handleDetect = async () => {
    if (!narrative) return;
    setDetecting(true);
    setStreamText('');
    try {
      const headIndex = state.resolvedEntryKeys.length - 1;
      const result = await detectPatterns(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        (token) => setStreamText((prev) => prev + token),
      );
      if (result.detectedParadigm) setParadigm(result.detectedParadigm);
      setGenre(result.detectedGenre);
      setSubgenre(result.detectedSubgenre);
      setPatterns(result.patterns);
      setAntiPatterns(result.antiPatterns);
    } catch (err) {
      console.error('Pattern detection failed:', err);
    } finally {
      setDetecting(false);
      setStreamText('');
    }
  };

  const handleSave = () => {
    dispatch({
      type: 'SET_DETECTED_PATTERNS',
      paradigm,
      genre,
      subgenre,
      patterns,
      antiPatterns,
    });
    onClose();
  };

  const hasChanges =
    paradigm !== narrative?.paradigm ||
    genre !== (narrative?.genre ?? '') ||
    subgenre !== (narrative?.subgenre ?? '') ||
    JSON.stringify(patterns) !== JSON.stringify(narrative?.patterns ?? []) ||
    JSON.stringify(antiPatterns) !== JSON.stringify(narrative?.antiPatterns ?? []);

  if (!narrative) return null;

  return (
    <Modal onClose={detecting ? () => {} : onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose} hideClose={detecting}>
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-text-primary">Pattern Profile</h2>
            <span className="text-[10px] text-text-dim">Auto-detect or manually define world view commandments</span>
          </div>
        </div>
      </ModalHeader>
      <ModalBody className="p-5 space-y-5">
        {/* Detection section */}
        {detecting ? (
          <StreamingStatus label="Analyzing world view…" streamText={streamText} maxHeight="max-h-24" />
        ) : (
          <button
            onClick={handleDetect}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 transition-colors text-[12px] font-medium"
          >
            <IconRefresh size={14} />
            Auto-Detect Genre & Patterns
          </button>
        )}

        {/* Paradigm / Genre / Subgenre */}
        <div className="border border-white/10 rounded-lg bg-bg-elevated/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] uppercase tracking-widest text-text-dim">Detected Classification</span>
            {(paradigm || genre || subgenre) && (
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {paradigm && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
                    {paradigm}
                  </span>
                )}
                {genre && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-medium">
                    {genre}
                  </span>
                )}
                {subgenre && (
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-medium">
                    {subgenre}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Paradigm selector — six canonical world-shapes */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest text-text-dim">Paradigm</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PARADIGMS.map((p) => {
                const active = paradigm === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setParadigm(p.value)}
                    title={p.hint}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition text-left ${
                      active
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/4 hover:bg-white/8 border-white/10 hover:border-white/20 text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className={`text-[10px] mt-0.5 leading-tight ${active ? 'text-emerald-300/70' : 'text-text-dim'}`}>
                      {p.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-text-dim">Genre</label>
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="e.g., Fantasy, Sci-Fi, Romance"
                className="w-full bg-bg-base border border-white/10 rounded-lg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-text-dim">Subgenre</label>
              <input
                value={subgenre}
                onChange={(e) => setSubgenre(e.target.value)}
                placeholder="e.g., Progression Fantasy, Space Opera"
                className="w-full bg-bg-base border border-white/10 rounded-lg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-white/5" />

        <CommandmentList
          title="Patterns"
          description="Positive commandments — what makes this series good. Genre-specific tropes to embrace."
          items={patterns}
          onAdd={(item) => setPatterns([...patterns, item])}
          onRemove={(index) => setPatterns(patterns.filter((_, i) => i !== index))}
          onReplace={setPatterns}
          placeholder="e.g., Every power-up must be earned through sacrifice"
          accentColor="emerald"
        />

        <div className="border-t border-white/5" />

        <CommandmentList
          title="Anti-Patterns"
          description="Negative commandments — what to avoid. Common genre pitfalls to sidestep."
          items={antiPatterns}
          onAdd={(item) => setAntiPatterns([...antiPatterns, item])}
          onRemove={(index) => setAntiPatterns(antiPatterns.filter((_, i) => i !== index))}
          onReplace={setAntiPatterns}
          placeholder="e.g., No deus ex machina power-ups"
          accentColor="red"
        />
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          disabled={detecting}
          className="text-[11px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges || detecting}
          className="text-[11px] px-3 py-1.5 rounded-md bg-white/10 text-text-primary hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
}
