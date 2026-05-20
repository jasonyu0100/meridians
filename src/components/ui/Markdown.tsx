'use client';

/**
 * Lightweight markdown renderer — handles the small set of constructs
 * the platform's LLM prompts emit: H2/H3 headings, paragraphs, lists,
 * bold/italic/code inline tokens. Avoids pulling react-markdown for
 * the surface area we actually need. Shared by BranchChat,
 * CompactPreviewModal, and any other place we render LLM markdown.
 *
 * The `variant` prop tunes spacing density:
 *   - 'compact' — tight, designed for chat bubbles and inline previews
 *   - 'reading' — generous, designed for document-style content
 */

import React, { useMemo } from 'react';

type MdBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] };

export function Markdown({
  text,
  variant = 'compact',
}: {
  text: string;
  variant?: 'compact' | 'reading';
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);
  const isReading = variant === 'reading';
  return (
    <div
      className={
        isReading
          ? 'text-[14px] text-text-secondary leading-relaxed flex flex-col gap-4'
          : 'text-[12.5px] text-text-secondary leading-relaxed flex flex-col gap-2.5'
      }
    >
      {blocks.map((b, i) => {
        if (b.type === 'h2') {
          return (
            <h3
              key={i}
              className={
                isReading
                  ? 'text-[16px] text-text-primary font-semibold mt-3'
                  : 'text-[11px] uppercase tracking-widest text-text-primary/85 font-semibold mt-2'
              }
            >
              {renderInline(b.text)}
            </h3>
          );
        }
        if (b.type === 'h3') {
          return (
            <h4
              key={i}
              className={
                isReading
                  ? 'text-[13px] text-text-primary font-semibold mt-2'
                  : 'text-[11px] text-text-primary/75 font-semibold'
              }
            >
              {renderInline(b.text)}
            </h4>
          );
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="flex flex-col gap-1 pl-3">
              {b.items.map((it, j) => (
                <li key={j} className="text-text-secondary leading-relaxed">
                  <span className="text-text-dim/50 mr-1.5">·</span>
                  {renderInline(it)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="leading-relaxed">
            {renderInline(b.text)}
          </p>
        );
      })}
    </div>
  );
}

function parseMarkdownBlocks(text: string): MdBlock[] {
  const lines = text.split('\n');
  const out: MdBlock[] = [];
  let buf: string[] = [];
  let listBuf: string[] = [];

  function flushPara() {
    if (buf.length) {
      out.push({ type: 'p', text: buf.join(' ').trim() });
      buf = [];
    }
  }
  function flushList() {
    if (listBuf.length) {
      out.push({ type: 'list', items: listBuf });
      listBuf = [];
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h2 = /^##\s+(.+)/.exec(line);
    if (h2) {
      flushPara();
      flushList();
      out.push({ type: 'h2', text: h2[1] });
      continue;
    }
    const h3 = /^###\s+(.+)/.exec(line);
    if (h3) {
      flushPara();
      flushList();
      out.push({ type: 'h3', text: h3[1] });
      continue;
    }
    const li = /^\s*[-*]\s+(.+)/.exec(line);
    if (li) {
      flushPara();
      listBuf.push(li[1]);
      continue;
    }
    flushList();
    buf.push(line);
  }
  flushPara();
  flushList();
  return out;
}

function renderInline(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > -1) {
        out.push(
          <strong key={key++} className="text-text-primary font-semibold">
            {text.slice(i + 2, end)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > -1) {
        out.push(
          <em key={key++} className="italic text-text-secondary">
            {text.slice(i + 1, end)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > -1) {
        out.push(
          <code
            key={key++}
            className="text-text-primary bg-white/6 rounded px-1 py-px text-[11px] font-mono"
          >
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    const next = nextSpecial(text, i);
    out.push(text.slice(i, next));
    i = next;
  }
  return out;
}

function nextSpecial(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '*' || c === '`') return i;
  }
  return text.length;
}
