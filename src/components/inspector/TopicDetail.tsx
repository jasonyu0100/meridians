'use client';

// TopicDetail — inspector view for one curriculum Topic: rename, describe,
// re-parent (cycle-guarded), and browse its subtopics and questions. Mirrors
// the entity-detail layout (CharacterDetail / ArtifactDetail): inline-editable
// name + monospace id, then collapsible sections.

import { useMemo } from 'react';
import { useStore } from '@/lib/state/store';
import { InlineText } from './InlineEdit';
import { CollapsibleSection } from './CollapsibleSection';
import {
  topicAncestors,
  topicChildren,
  topicDescendants,
  topicPath,
} from '@/lib/learning/curriculum';
import type { LearningQuestion } from '@/types/narrative';

export default function TopicDetail({ topicId }: { topicId: string }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const topics = useMemo(() => narrative?.topics ?? {}, [narrative?.topics]);
  const topic = topics[topicId];

  const subtree = useMemo(
    () => (topic ? topicDescendants(topics, topicId) : new Set<string>()),
    [topics, topicId, topic],
  );
  const questions = useMemo(() => {
    if (!narrative) return [] as { q: LearningQuestion; sceneId: string }[];
    const out: { q: LearningQuestion; sceneId: string }[] = [];
    for (const scene of Object.values(narrative.scenes)) {
      for (const q of scene.questions ?? []) {
        if (q.topicId && subtree.has(q.topicId)) out.push({ q, sceneId: scene.id });
      }
    }
    return out;
  }, [narrative, subtree]);

  if (!narrative || !topic) return null;

  const children = topicChildren(topics, topicId);
  const ancestors = topicAncestors(topics, topicId).reverse();

  // Valid re-parent targets: every topic except self and its descendants.
  const parentOptions = Object.values(topics)
    .filter((t) => !subtree.has(t.id))
    .sort((a, b) => topicPath(topics, a.id).localeCompare(topicPath(topics, b.id)));

  return (
    <div className="flex flex-col gap-4">
      {/* Name + ID — inline-editable, matching the entity inspectors */}
      <div className="flex flex-col gap-0.5">
        {ancestors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-text-dim mb-0.5">
            {ancestors.map((a, i) => (
              <span key={a.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-text-dim/40">/</span>}
                <button
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'topic', topicId: a.id } })}
                  className="hover:text-text-secondary transition-colors"
                >
                  {a.name}
                </button>
              </span>
            ))}
          </div>
        )}
        <InlineText
          value={topic.name}
          onSave={(name) => dispatch({ type: 'UPDATE_TOPIC', topicId, patch: { name } })}
          className="text-sm font-semibold text-text-primary"
          inputClassName="text-sm font-semibold"
        />
        <div className="flex items-center gap-2 text-[10px] text-text-dim">
          <span className="font-mono">{topicId}</span>
          <span>·</span>
          <span>{questions.length} {questions.length === 1 ? 'question' : 'questions'}</span>
          {children.length > 0 && <span>· {children.length} subtopics</span>}
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Description</h3>
        <InlineText
          value={topic.description ?? ''}
          onSave={(description) => dispatch({ type: 'UPDATE_TOPIC', topicId, patch: { description } })}
          multiline
          placeholder="Click to describe what this topic covers."
          className="text-xs text-text-secondary leading-relaxed italic"
          inputClassName="text-xs leading-relaxed"
        />
      </div>

      {/* Parent — re-parent the topic */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Parent</h3>
        <select
          value={topic.parentId ?? ''}
          onChange={(e) =>
            dispatch({ type: 'UPDATE_TOPIC', topicId, patch: { parentId: e.target.value || null } })
          }
          className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-[11px] text-text-secondary focus:outline-none focus:border-accent/40"
        >
          <option value="">— Root topic —</option>
          {parentOptions.map((t) => (
            <option key={t.id} value={t.id} className="bg-bg-overlay text-text-primary">
              {topicPath(topics, t.id)}
            </option>
          ))}
        </select>
      </div>

      {/* Subtopics */}
      {children.length > 0 && (
        <CollapsibleSection title="Subtopics" count={children.length} defaultOpen>
          <div className="flex flex-wrap gap-1.5">
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'topic', topicId: c.id } })}
                className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
              >
                {c.name}
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Questions in subtree */}
      {questions.length > 0 && (
        <CollapsibleSection title="Questions" count={questions.length} defaultOpen>
          <div className="flex flex-col gap-2">
            {questions.map(({ q, sceneId }) => (
              <button
                key={q.id}
                onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'question', sceneId, questionId: q.id } })}
                className="group flex flex-col gap-1 rounded bg-white/3 p-2 text-left transition-colors hover:bg-white/7"
              >
                <p className="text-xs text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
                  {q.prompt}
                </p>
                <span className="text-[9px] uppercase tracking-wider text-text-dim/60">
                  {q.id} · {q.bloom} · {q.difficulty}
                </span>
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
