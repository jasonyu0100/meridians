'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Inline click-to-edit primitives for the inspector. Click a value to edit it in
 * place; Enter (or blur) commits, Esc cancels. Used to make the three forces'
 * detail panels editable without a separate edit mode.
 */

export function InlineText({
  value,
  onSave,
  multiline = false,
  placeholder = '—',
  className = '',
  inputClassName = '',
}: {
  value: string;
  onSave: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Snapshot the current value into the draft when entering edit mode — no
  // value→draft sync effect needed (the read view shows `value` directly).
  const startEditing = () => { setDraft(value); setEditing(true); };

  useEffect(() => {
    if (!editing) return;
    const el = multiline ? areaRef.current : inputRef.current;
    el?.focus();
    el?.select();
  }, [editing, multiline]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
  };
  const cancel = () => setEditing(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  };

  if (!editing) {
    return (
      <span
        onClick={startEditing}
        title="Click to edit"
        className={`cursor-text rounded px-0.5 -mx-0.5 hover:bg-white/8 transition-colors ${value ? '' : 'text-text-dim italic'} ${className}`}
      >
        {value || placeholder}
      </span>
    );
  }

  const cls = `w-full bg-bg-elevated border border-accent/50 rounded px-1.5 py-0.5 text-text-primary outline-none ${inputClassName}`;
  return multiline ? (
    <textarea
      ref={areaRef}
      value={draft}
      rows={3}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={`${cls} resize-y leading-relaxed`}
    />
  ) : (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cls}
    />
  );
}

export function InlineSelect<T extends string>({
  value,
  options,
  onSave,
  labelFor,
  className = '',
}: {
  value: T;
  options: readonly T[];
  onSave: (next: T) => void;
  labelFor?: (v: T) => string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value as T;
        if (next !== value) onSave(next);
      }}
      title="Click to change"
      className={`w-fit max-w-full cursor-pointer bg-transparent border-0 outline-none appearance-auto pr-0.5 hover:text-text-primary transition-colors ${className}`}
    >
      {options.map((o) => (
        <option key={o} value={o}>{labelFor ? labelFor(o) : o}</option>
      ))}
    </select>
  );
}
