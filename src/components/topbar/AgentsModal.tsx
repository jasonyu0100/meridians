'use client';
// AgentsModal — manage the room's AI players. The roster is the hardcoded
// BUILTIN_AGENTS (one per preset persona, read-only) plus the GM's own custom
// agents (editable name + free-text persona). Mirrors MembersModal's table
// design: a Name column and a Persona text column, with built-in rows shown
// read-only. Blank custom rows are pruned on open/close.

import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/state/store';
import type { Agent } from '@/types/narrative';
import { BUILTIN_AGENTS, agentPersonaText, suggestAgentName } from '@/lib/agents/personas';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { IconTrash, IconPlus, IconSparkle, IconDice } from '@/components/icons';

const uid = () => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const cellInput =
  'w-full bg-transparent px-2.5 py-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-dim/30 focus:bg-white/5 rounded';

// A custom agent is "blank" once it has no name and no persona text — never
// filled, safe to prune.
const isBlank = (a: Agent) => !a.name?.trim() && !a.customPersona?.trim();

export function AgentsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;
  const customAgents = useMemo(() => Object.values(n?.agents ?? {}), [n?.agents]);

  // Drop never-filled custom agent objects on open and close.
  const agentsRef = useRef(customAgents);
  agentsRef.current = customAgents;
  const pruneBlanks = () => {
    for (const a of agentsRef.current) if (isBlank(a)) dispatch({ type: 'REMOVE_AGENT', id: a.id });
  };
  useEffect(() => {
    pruneBlanks();
    return pruneBlanks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (agent: Agent, p: Partial<Agent>) =>
    dispatch({ type: 'UPSERT_AGENT', agent: { ...agent, ...p } });

  // Names taken by built-ins + every custom agent other than `exceptId`.
  const takenNames = (exceptId: string) => [
    ...BUILTIN_AGENTS.map((a) => a.name),
    ...agentsRef.current.filter((a) => a.id !== exceptId).map((a) => a.name),
  ];

  const addAgent = () =>
    dispatch({
      type: 'UPSERT_AGENT',
      agent: { id: uid(), name: suggestAgentName(takenNames('')), persona: 'custom' },
    });

  const total = BUILTIN_AGENTS.length + customAgents.length;

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <IconSparkle size={15} />
          <h2 className="text-sm font-semibold text-text-primary">Agents</h2>
          <span className="text-[11px] text-text-dim/50">{total} AI {total === 1 ? 'player' : 'players'}</span>
        </div>
      </ModalHeader>
      <ModalBody className="p-5 space-y-3">
        <p className="text-[11px] text-text-dim/60 leading-relaxed">
          Agents are AI players. The <span className="text-text-secondary">built-in</span> roster gives one
          ready player per persona; add <span className="text-text-secondary">custom</span> agents with a
          free-text temperament of your own. Either can operate an entity from its perspective — assign one
          when you open a stream.
        </p>

        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-text-dim/50">
                <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[34%]">Name</th>
                <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[60%]">Persona</th>
                <th className="px-2.5 py-1.5 border-b border-white/6 w-[6%]" />
              </tr>
            </thead>
            <tbody>
              {/* Built-in agents — read-only, one per persona. */}
              {BUILTIN_AGENTS.map((a) => (
                <tr key={a.id} className="border-b border-white/6 hover:bg-white/[0.02]">
                  <td className="border-r border-white/6 px-2.5 py-1.5">
                    <span className="text-text-secondary">{a.name}</span>
                  </td>
                  <td className="border-r border-white/6 px-2.5 py-1.5 text-text-dim/70 leading-snug">
                    {agentPersonaText(a)}
                  </td>
                  <td className="text-center">
                    <span className="text-[9px] uppercase tracking-wide text-text-dim/35" title="Built-in agent — read-only">built-in</span>
                  </td>
                </tr>
              ))}

              {/* Custom agents — editable name + free-text persona. */}
              {customAgents.map((a) => {
                const name = a.name?.trim().toLowerCase() ?? '';
                const dup =
                  (!!name && customAgents.some((o) => o.id !== a.id && o.name?.trim().toLowerCase() === name)) ||
                  (!!name && BUILTIN_AGENTS.some((o) => o.name.toLowerCase() === name));
                return (
                  <tr key={a.id} className="border-b border-white/6 last:border-0 hover:bg-white/[0.02]">
                    <td className="border-r border-white/6">
                      <div className="flex items-center">
                        <input
                          value={a.name}
                          onChange={(e) => patch(a, { name: e.target.value })}
                          placeholder="Agent name"
                          title={dup ? 'Another agent already uses this name' : undefined}
                          className={`${cellInput} ${dup ? 'text-red-300' : ''}`}
                        />
                        <button
                          onClick={() => patch(a, { name: suggestAgentName(takenNames(a.id)) })}
                          className="shrink-0 px-2 text-text-dim/40 hover:text-violet-300 transition-colors"
                          title="Suggest a unique name"
                        >
                          <IconDice size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="border-r border-white/6">
                      <input
                        value={a.customPersona ?? ''}
                        onChange={(e) => patch(a, { persona: 'custom', customPersona: e.target.value || undefined })}
                        placeholder="Describe this player's temperament — how it reads, leans, and frames priors…"
                        className={cellInput}
                      />
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => dispatch({ type: 'REMOVE_AGENT', id: a.id })}
                        className="inline-flex justify-center text-text-dim/40 hover:text-red-400 transition-colors"
                        title="Remove agent"
                      >
                        <IconTrash size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          onClick={addAgent}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 text-[12px] text-text-dim/60 hover:text-text-primary hover:border-white/20 hover:bg-white/[0.02] transition-colors"
        >
          <IconPlus size={13} />
          Add custom agent
        </button>
      </ModalBody>
    </Modal>
  );
}
