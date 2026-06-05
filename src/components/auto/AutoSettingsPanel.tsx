'use client';
// AutoSettingsPanel — settings UI for the auto-generation engine (direction, constraints, pacing).

import { useState } from 'react';
import { useStore } from '@/lib/state/store';
import { GuidanceFields } from '@/components/generation/GuidanceFields';
import type { AutoConfig, AutoEndCondition } from '@/types/narrative';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { Segmented } from '@/components/ui/Segmented';

type Tab = 'end' | 'direction';

const TABS: { label: string; value: Tab }[] = [
  { label: 'End', value: 'end' },
  { label: 'Direction', value: 'direction' },
];


export function AutoSettingsPanel({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('end');
  const hasCoordinationPlan = !!(state.activeNarrative?.branches && state.viewState.activeBranchId && state.activeNarrative.branches[state.viewState.activeBranchId]?.coordinationPlan);

  const [config, setConfig] = useState<AutoConfig>(() => {
    const base = { ...state.autoConfig };
    // When coordination plan is active, default to planning_complete instead of scene_count
    if (hasCoordinationPlan && !base.endConditions.some(c => c.type === 'planning_complete')) {
      base.endConditions = [{ type: 'planning_complete' }];
    }
    return base;
  });

  function update(partial: Partial<AutoConfig>) {
    setConfig((c) => ({ ...c, ...partial }));
  }

  function handleStart() {
    if (config.endConditions.length === 0) return;
    dispatch({ type: 'SET_AUTO_CONFIG', config });
    onStart();
    onClose();
  }

  // End condition helpers
  const hasEndCondition = (type: string) => config.endConditions.some((c) => c.type === type);
  const getEndCondition = (type: string) => config.endConditions.find((c) => c.type === type);

  function toggleEndCondition(type: string, defaultCond: AutoEndCondition) {
    if (hasEndCondition(type)) {
      if (config.endConditions.length <= 1) return;
      update({ endConditions: config.endConditions.filter((c) => c.type !== type) });
    } else {
      update({ endConditions: [...config.endConditions, defaultCond] });
    }
  }

  function updateEndCondition(type: string, updater: (c: AutoEndCondition) => AutoEndCondition) {
    update({
      endConditions: config.endConditions.map((c) => (c.type === type ? updater(c) : c)),
    });
  }

  const noEndConditions = config.endConditions.length === 0;

  return (
    <Modal onClose={onClose} size="lg" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Auto Mode Settings</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">Configure autonomous world view generation</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* Tabs */}
        <Segmented<Tab>
          options={TABS}
          value={tab}
          onChange={setTab}
          size="sm"
          uppercase
          className="shrink-0"
        />

        <div className="flex flex-col gap-4">
          {tab === 'end' && (
            <>
              {!hasEndCondition('manual_stop') && (
                <>
                  <p className="text-[10px] text-text-dim leading-relaxed">
                    At least one end condition is required. You can always stop manually.
                  </p>

                  {/* Scene count */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasEndCondition('scene_count')}
                      onChange={() => toggleEndCondition('scene_count', { type: 'scene_count', target: 50 })}
                      className="accent-yellow-500"
                    />
                    <span className="text-xs text-text-secondary">Stop at scene count</span>
                  </label>
                  {hasEndCondition('scene_count') && (
                    <div className="ml-6">
                      <input
                        type="number"
                        min={5}
                        max={500}
                        value={(getEndCondition('scene_count') as { type: 'scene_count'; target: number })?.target ?? 50}
                        onChange={(e) =>
                          updateEndCondition('scene_count', () => ({ type: 'scene_count', target: Number(e.target.value) }))
                        }
                        className="bg-bg-field border border-border rounded px-2 py-1 text-xs text-text-primary w-20 outline-none"
                      />
                      <span className="text-[10px] text-text-dim ml-2">scenes</span>
                    </div>
                  )}

                  {/* Arc count */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasEndCondition('arc_count')}
                      onChange={() => toggleEndCondition('arc_count', { type: 'arc_count', target: 10 })}
                      className="accent-yellow-500"
                    />
                    <span className="text-xs text-text-secondary">Stop at arc count</span>
                  </label>
                  {hasEndCondition('arc_count') && (
                    <div className="ml-6">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={(getEndCondition('arc_count') as { type: 'arc_count'; target: number })?.target ?? 10}
                        onChange={(e) =>
                          updateEndCondition('arc_count', () => ({ type: 'arc_count', target: Number(e.target.value) }))
                        }
                        className="bg-bg-field border border-border rounded px-2 py-1 text-xs text-text-primary w-20 outline-none"
                      />
                      <span className="text-[10px] text-text-dim ml-2">arcs</span>
                    </div>
                  )}
                </>
              )}

              {/* Planning complete */}
              {hasCoordinationPlan && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasEndCondition('planning_complete')}
                    onChange={() => toggleEndCondition('planning_complete', { type: 'planning_complete' })}
                    className="accent-white/80"
                  />
                  <span className="text-xs text-text-secondary">Stop when coordination plan completes</span>
                </label>
              )}

              {/* Manual stop — warning zone */}
              <div className={`border border-amber-500/30 rounded-lg p-3 bg-amber-500/5 ${hasEndCondition('manual_stop') ? '' : 'mt-4'}`}>
                <p className="text-[10px] text-amber-400/80 uppercase tracking-widest font-semibold mb-2">Warning</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasEndCondition('manual_stop')}
                    onChange={() => {
                      if (hasEndCondition('manual_stop')) {
                        // Turning off manual stop — restore a default end condition
                        update({ endConditions: [{ type: 'scene_count', target: 50 }] });
                      } else {
                        // Turning on manual stop — clear all other conditions
                        update({ endConditions: [{ type: 'manual_stop' }] });
                      }
                    }}
                    className="accent-amber-500"
                  />
                  <span className="text-xs text-text-secondary">Manual stop only</span>
                </label>
                <p className="text-[10px] text-text-dim leading-relaxed mt-1 ml-6">
                  {hasEndCondition('manual_stop')
                    ? 'All automatic end conditions are disabled. Generation runs indefinitely until you manually stop it.'
                    : 'No automatic stopping — generation runs indefinitely until you manually stop it.'}
                </p>
              </div>
            </>
          )}

          {tab === 'direction' && (
            <>
              <p className="text-[10px] text-text-dim leading-relaxed">
                Direction and constraints guide every arc. Use the planning queue for long-form narrative structure.
              </p>

              {/* Direction + Constraints */}
              <GuidanceFields
                direction={config.direction}
                constraints={config.narrativeConstraints}
                onDirectionChange={(v) => update({ direction: v })}
                onConstraintsChange={(v) => update({ narrativeConstraints: v })}
              />
            </>
          )}

        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={handleStart}
          disabled={noEndConditions}
          className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
            noEndConditions
              ? 'bg-white/4 text-text-dim cursor-not-allowed'
              : 'bg-white/12 text-text-primary hover:bg-white/16'
          }`}
        >
          Start Auto Mode
        </button>
      </ModalFooter>
    </Modal>
  );
}
