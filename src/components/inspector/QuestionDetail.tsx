'use client';

// QuestionDetail — inspector view for one learning question: stem, options
// (correct marked), explanation, and the topic it's assigned to (reassignable).
// Mirrors the entity-detail layout: content-led header + monospace id, then
// labelled sections.

import { useStore } from '@/lib/state/store';
import { IconCheck } from '@/components/icons';
import { topicPath } from '@/lib/learning/curriculum';

export default function QuestionDetail({
  sceneId,
  questionId,
}: {
  sceneId: string;
  questionId: string;
}) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const scene = narrative?.scenes[sceneId];
  const question = scene?.questions?.find((q) => q.id === questionId);
  if (!narrative || !scene || !question) return null;

  const topics = narrative.topics ?? {};
  const topicOptions = Object.values(topics).sort((a, b) =>
    topicPath(topics, a.id).localeCompare(topicPath(topics, b.id)),
  );
  const sceneIdx = state.resolvedEntryKeys.indexOf(sceneId);

  return (
    <div className="flex flex-col gap-4">
      {/* Stem + ID — content-led, matching the entity inspectors */}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-text-primary leading-relaxed">{question.prompt}</p>
        <div className="flex items-center gap-2 text-[10px] text-text-dim">
          <span className="font-mono">{questionId}</span>
          <span>·</span>
          <span className="uppercase tracking-wider">{question.bloom}</span>
          <span>·</span>
          <span className="uppercase tracking-wider">{question.difficulty}</span>
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Options</h3>
        {question.options.map((opt, i) => {
          const correct = i === question.correctIndex;
          return (
            <div
              key={i}
              className={`flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-md ${
                correct ? 'bg-emerald-500/10 text-emerald-200' : 'text-text-secondary bg-white/3'
              }`}
            >
              <span className="shrink-0 w-4 text-center">
                {correct ? (
                  <IconCheck size={12} />
                ) : (
                  <span className="text-text-dim/40 text-[10px] font-mono">
                    {String.fromCharCode(65 + i)}
                  </span>
                )}
              </span>
              {opt}
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      {question.explanation && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Explanation</h3>
          <p className="text-xs text-text-dim/80 leading-relaxed italic">{question.explanation}</p>
        </div>
      )}

      {/* Topic — reassign */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Topic</h3>
        <select
          value={question.topicId ?? ''}
          onChange={(e) =>
            dispatch({
              type: 'SET_QUESTION_TOPIC',
              sceneId,
              questionId,
              topicId: e.target.value || undefined,
            })
          }
          className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-[11px] text-text-secondary focus:outline-none focus:border-accent/40"
        >
          <option value="">— Untopiced —</option>
          {topicOptions.map((t) => (
            <option key={t.id} value={t.id} className="bg-bg-overlay text-text-primary">
              {topicPath(topics, t.id)}
            </option>
          ))}
        </select>
        {question.topicId && topics[question.topicId] && (
          <button
            onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'topic', topicId: question.topicId! } })}
            className="self-start mt-1 text-[10px] text-accent hover:opacity-80 transition-opacity"
          >
            Open topic →
          </button>
        )}
      </div>

      {/* Source scene */}
      <div className="pt-2 border-t border-white/8">
        <button
          onClick={() => {
            if (sceneIdx >= 0) dispatch({ type: 'SET_SCENE_INDEX', index: sceneIdx });
            dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } });
          }}
          className="text-[10px] text-text-dim hover:text-text-secondary transition-colors"
        >
          From scene{sceneIdx >= 0 ? ` ${sceneIdx + 1}` : ''}: {scene.summary?.slice(0, 60) || 'untitled'} →
        </button>
      </div>
    </div>
  );
}
