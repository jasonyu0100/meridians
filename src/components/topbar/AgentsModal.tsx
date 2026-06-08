'use client';
// AgentsModal — dedicated TopBar interface for managing the room's AI players.
// Each agent has a name and a persona: either a preset personality (the basis
// for varying, unique players) or a custom prompt. Agents are an alternative to
// real members for thinking about a perspective's priors (assigned per-stream
// in the Streams composer). Blank rows are pruned on open/close so an
// added-but-never-named agent never lingers as a dead row.

import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/state/store';
import type { Agent, AgentPersonaKey } from '@/types/narrative';
import { AGENT_PERSONA_PRESETS, suggestAgentName } from '@/lib/agents/personas';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { IconTrash, IconPlus, IconSparkle, IconDice } from '@/components/icons';

const uid = () => `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const cellInput =
  'w-full bg-transparent px-2.5 py-1.5 text-[12px] text-text-primary outline-none placeholder:text-text-dim/30 focus:bg-white/5 rounded';

const isBlank = (a: Agent) => !a.name?.trim() && a.persona === 'strategist' && !a.customPersona?.trim();

export function AgentsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const n = state.activeNarrative;
  const agents = useMemo(() => Object.values(n?.agents ?? {}), [n?.agents]);

  // Drop never-filled agent objects on open and close, so an added-but-untouched
  // row never persists.
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
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

  // Names taken by every agent other than `exceptId` — what a suggestion must avoid.
  const takenNames = (exceptId: string) =>
    agentsRef.current.filter((a) => a.id !== exceptId).map((a) => a.name);

  const addAgent = () =>
    dispatch({
      type: 'UPSERT_AGENT',
      agent: { id: uid(), name: suggestAgentName(agents.map((a) => a.name)), persona: 'strategist' },
    });

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <IconSparkle size={15} />
          <h2 className="text-sm font-semibold text-text-primary">Agents</h2>
          <span className="text-[11px] text-text-dim/50">{agents.length} AI {agents.length === 1 ? 'player' : 'players'}</span>
        </div>
      </ModalHeader>
      <ModalBody className="p-5 space-y-3">
        <p className="text-[11px] text-text-dim/60 leading-relaxed">
          Agents are AI players. Give each a persona — a preset personality or a custom prompt — and it can
          operate an entity from that entity&apos;s perspective, augmenting stream suggestions, intuitions, and
          priors. Assign one to a perspective when you open a stream.
        </p>

        {agents.length > 0 && (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-text-dim/50">
                  <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[50%]">Name</th>
                  <th className="text-left font-medium px-2.5 py-1.5 border-b border-r border-white/6 w-[44%]">Persona</th>
                  <th className="px-2.5 py-1.5 border-b border-white/6 w-[6%]" />
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const preset = AGENT_PERSONA_PRESETS.find((p) => p.key === a.persona);
                  const name = a.name?.trim().toLowerCase() ?? '';
                  const dup = !!name && agents.some((o) => o.id !== a.id && o.name?.trim().toLowerCase() === name);
                  return (
                    <Fragment key={a.id}>
                      <tr className="border-b border-white/6 hover:bg-white/2">
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
                          <select
                            value={a.persona}
                            onChange={(e) => patch(a, { persona: e.target.value as AgentPersonaKey })}
                            title={preset?.description}
                            className={`${cellInput} cursor-pointer`}
                          >
                            {AGENT_PERSONA_PRESETS.map((p) => (
                              <option key={p.key} value={p.key}>{p.name}</option>
                            ))}
                            <option value="custom">Custom…</option>
                          </select>
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
                      {a.persona === 'custom' ? (
                        <tr className="border-b border-white/6">
                          <td colSpan={3} className="px-2.5 py-2">
                            <textarea
                              value={a.customPersona ?? ''}
                              onChange={(e) => patch(a, { customPersona: e.target.value || undefined })}
                              placeholder="Describe this player's temperament — how it reads, leans, and frames a perspective's priors…"
                              rows={3}
                              className="w-full bg-bg-field/60 border border-white/10 rounded px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent/40 resize-none leading-relaxed placeholder:text-text-dim/30"
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr className="border-b border-white/6 last:border-0">
                          <td colSpan={3} className="px-2.5 py-1.5 text-[11px] text-text-dim/50 leading-relaxed">
                            {preset?.description}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <button
          onClick={addAgent}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 text-[12px] text-text-dim/60 hover:text-text-primary hover:border-white/20 hover:bg-white/2 transition-colors"
        >
          <IconPlus size={13} />
          Add agent
        </button>
      </ModalBody>
    </Modal>
  );
}
