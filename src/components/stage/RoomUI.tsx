'use client';
// RoomUI — presentation primitives shared by the room/perspective surfaces
// (Streams, Merges/History, and the inspector). Avatars (member, agent, and
// the contributor→perspective pair badge), GitHub-style status octicons,
// perspective-name/entity resolution, and id minting live here so every
// surface reads the same.

import {
  type Merge,
  type NarrativeState,
  type Perspective,
  type PerspectiveKind,
  type Member,
  type Stream,
  type StreamPrior,
} from '@/types/narrative';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { agentPersonaLabel } from '@/lib/agents/personas';

export const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Build a fresh open Stream against a perspective, optionally seeded with a
 *  first prior. Module-level so the impure id/timestamp generation stays out of
 *  component render. */
export function buildStream(
  perspectiveId: string,
  title: string,
  memberId?: string,
  seedPrior?: string,
): Stream {
  const now = Date.now();
  return {
    id: uid('stream'),
    perspectiveId,
    memberId,
    title,
    state: 'open',
    priors: seedPrior ? [{ id: uid('p'), text: seedPrior, at: now }] : [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Build a Merge from a set of stream ids + their committed resolutions.
 *  Module-level to keep the impure id/timestamp generation out of render. */
export function buildMerge(
  streamIds: string[],
  label?: string,
  resolutions?: Record<string, import('@/types/narrative').MergeResolution>,
): Merge {
  return { id: uid('merge'), label, at: Date.now(), streamIds, resolutions };
}

/** Build a dated prior for a stream. Module-level (keeps Date.now out of render). */
export function buildPrior(text: string, authorId?: string): StreamPrior {
  return { id: uid('p'), authorId, text, at: Date.now() };
}

export const KIND_LABEL: Record<PerspectiveKind, string> = {
  character: 'Character',
  location: 'Location',
  artifact: 'Artifact',
  narrator: 'Narrator',
};

/** Resolve a perspective's display name — explicit label, else the bound
 *  entity's name, else the kind label. */
export function perspectiveName(p: Perspective | undefined, n: NarrativeState | null): string {
  if (!p) return 'unknown';
  if (p.label) return p.label;
  if (p.kind === 'narrator') return 'Narrator';
  const src =
    p.kind === 'character' ? n?.characters :
    p.kind === 'location' ? n?.locations :
    p.kind === 'artifact' ? n?.artifacts : null;
  const ent = p.entityRef && src ? src[p.entityRef] : undefined;
  return ent?.name ?? KIND_LABEL[p.kind];
}

// ── GitHub-style status octicons (16×16) ─────────────────────────────────────
function Octicon({ path, className, size = 16 }: { path: string; className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ISSUE_OPENED =
  'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z';
const ISSUE_CLOSED =
  'M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z';
const PR_OPEN =
  'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
const GIT_MERGE =
  'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM3.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
const PR_CLOSED =
  'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-9.5 5.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0-9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM9.42 3.146 11.27 1.3a.25.25 0 0 1 .354 0l.708.707a.25.25 0 0 1 0 .354L10.49 4.207l1.84 1.84a.25.25 0 0 1 0 .353l-.707.708a.25.25 0 0 1-.354 0L9.42 5.268 7.58 7.107a.25.25 0 0 1-.354 0l-.707-.708a.25.25 0 0 1 0-.353l1.84-1.84-1.84-1.84a.25.25 0 0 1 0-.354L7.226.954a.25.25 0 0 1 .354 0L9.42 2.793Z';

export const IssueOpenIcon = ({ size = 15 }: { size?: number }) => (
  <Octicon path={ISSUE_OPENED} size={size} className="text-emerald-400" />
);
export const IssueClosedIcon = ({ size = 15 }: { size?: number }) => (
  <Octicon path={ISSUE_CLOSED} size={size} className="text-purple-400" />
);
export const PrOpenIcon = ({ size = 15 }: { size?: number }) => (
  <Octicon path={PR_OPEN} size={size} className="text-emerald-400" />
);
export const PrMergedIcon = ({ size = 15 }: { size?: number }) => (
  <Octicon path={GIT_MERGE} size={size} className="text-purple-400" />
);
export const PrClosedIcon = ({ size = 15 }: { size?: number }) => (
  <Octicon path={PR_CLOSED} size={size} className="text-red-400" />
);

/** Icon for a stream by its state. */
export function StreamStateIcon({ state, size = 15 }: { state: Stream['state']; size?: number }) {
  if (state === 'committed') return <PrMergedIcon size={size} />;
  if (state === 'closed') return <PrClosedIcon size={size} />;
  return <PrOpenIcon size={size} />;
}

// ── Avatars & the member→perspective pair ────────────────────────────────────
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

export const memberName = (m: Member | undefined) =>
  m ? (`${m.firstName} ${m.lastName}`.trim() || 'unnamed') : 'unassigned';

/** The entity behind an entity-bound perspective (for its image / name). */
export function perspectiveEntity(p: Perspective | undefined, n: NarrativeState | null) {
  if (!p || p.kind === 'narrator' || !p.entityRef) return undefined;
  const src =
    p.kind === 'character' ? n?.characters :
    p.kind === 'location' ? n?.locations :
    p.kind === 'artifact' ? n?.artifacts : null;
  return src?.[p.entityRef];
}

/** A circular grey avatar (map style). Shows the entity image when available,
 *  otherwise initials. `ai` tints it violet to mark an AI player (agent) apart
 *  from a human member; `title` overrides the hover label (initials still come
 *  from `label`, so an agent can show "Name · Persona" on hover). */
export function Avatar({
  label,
  imageUrl,
  size = 26,
  selected = false,
  dim = false,
  ai = false,
  title,
}: {
  label: string;
  /** Resolved image URL (blob/http). */
  imageUrl?: string | null;
  size?: number;
  selected?: boolean;
  dim?: boolean;
  /** Mark as an AI player (agent) — violet tint instead of slate grey. */
  ai?: boolean;
  /** Hover label override; defaults to `label`. */
  title?: string;
}) {
  return (
    <div
      title={title ?? label}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full overflow-hidden flex items-center justify-center font-semibold leading-none shadow-sm ${
        ai ? 'bg-violet-300 text-violet-900' : 'bg-slate-300 text-slate-700'
      } ${dim ? 'opacity-40' : ''} ${selected ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-base' : ''}`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={label} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.36)) }}>{initialsOf(label)}</span>
      )}
    </div>
  );
}

/** Avatar for a perspective — resolves its entity image automatically. */
export function PerspectiveAvatar({
  perspective,
  n,
  size = 26,
  selected = false,
  dim = false,
}: {
  perspective?: Perspective;
  n: NarrativeState | null;
  size?: number;
  selected?: boolean;
  dim?: boolean;
}) {
  const entity = perspectiveEntity(perspective, n);
  const url = useImageUrl(entity?.imageUrl);
  return (
    <Avatar
      label={perspective ? perspectiveName(perspective, n) : '?'}
      imageUrl={url}
      size={size}
      selected={selected}
      dim={dim || !perspective}
    />
  );
}

/** The contributor → perspective pair, rendered as two avatars joined by an
 *  arrow. The contributor is a human member or — when `agentId` is set (an
 *  AI-driven stream) — the agent, shown violet-tinted with its persona on hover.
 *  Member and agent are mutually exclusive; the agent takes precedence. */
export function PerspectivePairBadge({
  memberId,
  agentId,
  perspectiveId,
  n,
  size = 22,
}: {
  memberId?: string;
  agentId?: string;
  perspectiveId?: string;
  n: NarrativeState | null;
  size?: number;
}) {
  const member = memberId ? n?.members?.[memberId] : undefined;
  const agent = agentId ? n?.agents?.[agentId] : undefined;
  const persp = perspectiveId ? n?.perspectives?.[perspectiveId] : undefined;
  return (
    <div className="flex items-center gap-1">
      {agent ? (
        <Avatar
          label={agent.name || 'Agent'}
          title={`${agent.name || 'Agent'} · ${agentPersonaLabel(agent)} · AI player`}
          size={size}
          ai
        />
      ) : (
        <Avatar label={memberName(member)} size={size} dim={!member} />
      )}
      <span className="text-text-dim/40 text-[11px]">→</span>
      <PerspectiveAvatar perspective={persp} n={n} size={size} />
    </div>
  );
}
