'use client';

/**
 * Markdown renderer — full CommonMark + GitHub-flavored markdown (tables,
 * strikethrough, task lists, autolinks) via react-markdown + remark-gfm,
 * with Tailwind-styled component overrides matching the app's dark theme.
 *
 * The `variant` prop tunes spacing density:
 *   - 'compact' — tight, designed for chat bubbles and inline previews
 *   - 'reading' — generous, designed for document-style content
 */

import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildCitationNumbers, entityRefRegex, splitEntityRefIds } from '@/lib/forces/entity-ref';
import { useStore } from '@/lib/state/store';
import { CitationNumberContext, EntityRef } from './EntityRef';

/** URL scheme used to smuggle a detected entity annotation through markdown
 *  link parsing so the `a` renderer can swap in an EntityRef chip. */
const ENTITY_HREF_PREFIX = 'entity:';

/** Rewrite bracketed entity annotations (`[C-12]`, `[SYS-4]`, …) into links
 *  with the `entity:` scheme. The `a` renderer detects that scheme and
 *  renders the interactive chip. Real markdown links are left untouched (the
 *  pattern skips tokens already followed by `(`). */
function linkifyEntityRefs(text: string): string {
  // A bracket may hold one id or a comma-separated list (`[C-31, C-32]`);
  // expand each into its own entity link so it renders as separate chips.
  return text.replace(entityRefRegex(), (_m, body) =>
    splitEntityRefIds(body)
      .map((id) => `[${id}](${ENTITY_HREF_PREFIX}${id})`)
      .join(' '),
  );
}

/** Preserve `entity:` links (default transform would strip the unknown
 *  scheme); defer to the default sanitiser for everything else. */
function entityUrlTransform(url: string): string {
  return url.startsWith(ENTITY_HREF_PREFIX) ? url : defaultUrlTransform(url);
}

export function Markdown({
  text,
  variant = 'compact',
  entities = false,
}: {
  text: string;
  variant?: 'compact' | 'reading';
  /** Detect `[C-12]`-style entity annotations and render them as interactive
   *  EntityRef chips (hover for detail, click to open in the inspector). */
  entities?: boolean;
}) {
  const { state } = useStore();
  const isReading = variant === 'reading';
  const components = isReading ? READING_COMPONENTS : COMPACT_COMPONENTS;
  const body = entities ? linkifyEntityRefs(text) : text;
  // Number distinct entity refs in order of first appearance so every EntityRef
  // chip can render its citation number, not the id. Resolved against the active
  // narrative — invalid ids are skipped here and hidden by EntityRef, keeping
  // the numbering contiguous.
  const citations = entities ? buildCitationNumbers(text, state.activeNarrative) : null;
  return (
    <CitationNumberContext.Provider value={citations}>
      <div
        className={
          isReading
            ? 'text-[14px] text-text-secondary leading-relaxed flex flex-col gap-4'
            : 'text-[13.5px] text-text-secondary leading-relaxed flex flex-col gap-2.5'
        }
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={components}
          urlTransform={entities ? entityUrlTransform : undefined}
        >
          {body}
        </ReactMarkdown>
      </div>
    </CitationNumberContext.Provider>
  );
}

const SHARED_COMPONENTS: Components = {
  strong: ({ children }) => (
    <strong className="text-text-primary font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-text-secondary">{children}</em>
  ),
  del: ({ children }) => (
    <del className="text-text-dim line-through">{children}</del>
  ),
  code: ({ className, children }) => {
    // Fenced code blocks get a `language-*` className from remark; inline
    // code does not. Inline gets the chip styling; fenced relies on the
    // parent <pre> for layout and keeps the className for any future
    // syntax highlighter to consume.
    if (className && /language-/.test(className)) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="text-text-primary bg-white/6 rounded px-1 py-px text-[11px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-black/40 border border-white/8 rounded-md p-3 overflow-x-auto text-[11.5px] font-mono text-text-secondary leading-relaxed">
      {children}
    </pre>
  ),
  a: ({ href, children }) => {
    // Entity annotations smuggled through as `entity:<id>` links render as
    // interactive chips instead of anchors.
    if (href && href.startsWith(ENTITY_HREF_PREFIX)) {
      return <EntityRef id={href.slice(ENTITY_HREF_PREFIX.length)} />;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sky-400 hover:text-sky-300 underline decoration-sky-400/40 hover:decoration-sky-300 underline-offset-2"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-white/15 pl-3 text-text-secondary/85 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-0 border-t border-white/10 my-1" />,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      className="max-w-full rounded-md border border-white/8"
    />
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto -mx-1 my-1">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-white/5 even:bg-white/2">{children}</tr>
  ),
  th: ({ children, style }) => (
    <th
      className="px-2 py-1.5 text-text-primary font-semibold border-b border-white/15"
      style={style}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      className="px-2 py-1.5 align-top text-text-secondary"
      style={style}
    >
      {children}
    </td>
  ),
  ul: ({ children }) => (
    <ul className="flex flex-col gap-1 pl-4 list-disc marker:text-text-dim/50">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="flex flex-col gap-1 pl-5 list-decimal marker:text-text-dim/60">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-text-secondary leading-relaxed">{children}</li>
  ),
  input: ({ type, checked, disabled }) => {
    if (type !== 'checkbox') return null;
    return (
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        readOnly
        className="mr-1.5 accent-sky-400 align-middle"
      />
    );
  },
};

const COMPACT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  h1: ({ children }) => (
    <h2 className="text-[12px] uppercase tracking-widest text-text-primary font-semibold mt-2">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="text-[11px] uppercase tracking-widest text-text-primary/85 font-semibold mt-2">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-[11px] text-text-primary/75 font-semibold">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="text-[10.5px] text-text-primary/65 font-semibold">{children}</h5>
  ),
  h5: ({ children }) => (
    <h6 className="text-[10px] text-text-primary/55 font-semibold">{children}</h6>
  ),
  h6: ({ children }) => (
    <h6 className="text-[10px] text-text-primary/55 font-semibold">{children}</h6>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
};

const READING_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  h1: ({ children }) => (
    <h1 className="text-[20px] text-text-primary font-semibold mt-4">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[16px] text-text-primary font-semibold mt-3">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[13px] text-text-primary font-semibold mt-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[12.5px] text-text-primary/85 font-semibold mt-2">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-[12px] text-text-primary/75 font-semibold">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-[12px] text-text-primary/65 font-semibold">{children}</h6>
  ),
  p: ({ children }) => <p className="leading-[1.8]">{children}</p>,
};
