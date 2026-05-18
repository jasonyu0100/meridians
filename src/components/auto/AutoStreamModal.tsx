'use client';

import { useEffect, useRef } from 'react';
import { Modal, ModalBody, ModalHeader } from '@/components/Modal';

/**
 * Live progress view for auto mode. Streams the in-flight LLM reasoning
 * trace from the active generation cycle. Acts as a "check in on a long
 * running process" surface — open it any time during a run to see what
 * the model is thinking; close it without affecting the run.
 */
export function AutoStreamModal({
  streamText,
  statusMessage,
  currentCycle,
  isRunning,
  onClose,
}: {
  streamText: string;
  statusMessage: string;
  currentCycle: number;
  isRunning: boolean;
  onClose: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-stick to the latest tokens as they arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [streamText.length]);

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="80vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-3">
          <span
            className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-text-dim/40'}`}
          />
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Auto Mode Progress</h2>
            <p className="text-[10px] text-text-dim uppercase tracking-wider">
              Cycle {currentCycle} · {statusMessage || (isRunning ? 'running' : 'idle')}
            </p>
          </div>
        </div>
      </ModalHeader>
      <ModalBody className="p-5">
        {streamText ? (
          <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap leading-relaxed">
            {streamText}
            <div ref={bottomRef} />
          </pre>
        ) : (
          <p className="text-[11px] text-text-dim/60 italic text-center py-8">
            {isRunning
              ? 'Waiting for the next reasoning trace…'
              : 'No active generation. Start auto mode to see live progress.'}
          </p>
        )}
      </ModalBody>
    </Modal>
  );
}
