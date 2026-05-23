'use client';

import React, { useMemo, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';

type Props = { onClose: () => void };

function Tex({ children, display }: { children: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, {
    displayMode: display ?? false,
    throwOnError: false,
  }), [children, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Block({ tex }: { tex: string }) {
  return (
    <div className="text-center py-2">
      <Tex display>{tex}</Tex>
    </div>
  );
}

function S({ title, analogy, children }: { title: string; analogy: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-widest border-b border-border/40 pb-1">{title}</h3>
      <p className="text-[10px] text-text-secondary italic">{analogy}</p>
      {children}
    </div>
  );
}

const tabs = ['Forces', 'Dynamics', 'Scoring'] as const;
type Tab = typeof tabs[number];

function ForcesTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        A book is a revelation machine. Two kinds of revelation, three forces. <B>Encyclopedic</B>: new entries (World = entity dossiers, System = world rulebook). <B>Possibility</B>: outcomes opening and closing (Fate). All rank&rarr;Gaussian normalized across scenes: <Tex>{String.raw`z_i = \Phi^{-1}(\text{rank}_i / (N{+}1))`}</Tex>.
      </p>

      <S title="Fate — possibility" analogy="How much did this scene reshape the live space of what could still happen? Odds moving on open questions.">
        <Block tex={String.raw`F_i = \sum_{t \in \Delta_i} v_t \cdot D_{\text{KL}}\!\left(\mathbf{p}_t^{+} \,\Big\|\, \mathbf{p}_t^{-}\right)`} />
        <p className="text-[10px] text-text-dim">
          Threads are prediction markets over named outcomes. <Tex>{String.raw`\mathbf{p}_t^{-}, \mathbf{p}_t^{+}`}</Tex> = narrator&apos;s prior and posterior distributions over thread <Tex>t</Tex>&apos;s outcomes (softmax of logits, before and after the scene). <Tex>v_t</Tex> = pre-scene volume (accumulated narrative attention). KL divergence scores how much the belief moved; attention weights which markets matter. Zero for pulses (<Tex>{String.raw`\mathbf{p}^{+} = \mathbf{p}^{-}`}</Tex>), large for twists and closures. Fate is a force of <em>possibility</em>, not probability &mdash; the market machinery is the accounting; reshaping the outcome space is the force.
        </p>
      </S>

      <S title="World — physical" analogy="How much new was written onto the dossiers of specific people, places, and artifacts this scene?">
        <Block tex={String.raw`W = \Delta N_c + \sqrt{\Delta E_c}`} />
        <p className="text-[10px] text-text-dim">
          Each entity (character, location, artifact) has its own dossier &mdash; a continuity graph of traits, beliefs, goals, secrets, capabilities, states. <Tex>{String.raw`\Delta N_c`}</Tex> = new entries across all dossiers this scene. <Tex>{String.raw`\Delta E_c`}</Tex> = new causal edges between entries. Nodes linear (each genuinely new ground); edges sqrt (first few connections matter most). Encyclopedic revelation about the people.
        </p>
      </S>

      <S title="System — abstract" analogy="How much new was written into the book's encyclopedia of how the world itself works?">
        <Block tex={String.raw`S = \Delta N + \sqrt{\Delta E}`} />
        <p className="text-[10px] text-text-dim">
          One shared knowledge graph for the world itself &mdash; rules, principles, concepts, tensions, events, structures. <Tex>{String.raw`\Delta N`}</Tex> = new entries this scene; <Tex>{String.raw`\Delta E`}</Tex> = new cross-references. Same shape as World (nodes linear, edges sqrt), different domain. Encyclopedic revelation about the rulebook.
        </p>
      </S>
    </div>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-text-primary">{children}</span>;
}

function DynamicsTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Derived metrics on top of the three forces — activity (overall rate), tension (buildup without release), swing (breathing), and the peak/valley detector.
      </p>

      <S title="Activity" analogy="How hard the revelation machine is working this scene — encyclopedia entries plus possibility reshaping, on one scale.">
        <Block tex={String.raw`A_i = w_F F_i + w_W W_i + w_S S_i, \quad w_F + w_W + w_S = 1`} />
        <p className="text-[10px] text-text-dim">
          Weighted sum of the three forces after rank&rarr;Gaussian normalisation. Weights come from PCA on the normalised force curves &mdash; the work&apos;s own signature, not a hand-picked archetype. Papers signature system-heavy, simulations fate-heavy, narratives balanced across all three. Peaks are scenes where the book is revealing a lot at once across its dominant channels.
        </p>
      </S>

      <S title="Tension" analogy="The coiled spring — encyclopedic growth piling up while possibility stays frozen.">
        <Block tex="T_i = W_i + S_i - F_i" />
        <p className="text-[10px] text-text-dim">
          High when entity dossiers and the world rulebook grow but no open questions resolve. Drops sharply at fate scenes &mdash; the possibility field releasing the stored encyclopedic pressure.
        </p>
      </S>

      <S title="Swing" analogy="The world view breathing — great world views alternate loud and quiet.">
        <Block tex={String.raw`\text{Sw}_i = \sqrt{\left(\tfrac{\Delta F}{\mu_F}\right)^{2} + \left(\tfrac{\Delta W}{\mu_W}\right)^{2} + \left(\tfrac{\Delta S}{\mu_S}\right)^{2}}`} />
        <p className="text-[10px] text-text-dim">
          Normalised Euclidean distance between consecutive force snapshots. Each delta divided by its reference mean (<Tex>{String.raw`\mu_F, \mu_W, \mu_S`}</Tex>) so the three forces contribute equally regardless of their natural scales.
        </p>
      </S>

      <S title="Peak & valley detection" analogy="Where are the climaxes and the breathing room?">
        <Block tex={String.raw`\tilde{A} = \mathcal{G}_{\sigma=1.5} \ast A, \qquad r = \max\!\left(2,\, \lfloor n/25 \rfloor\right)`} />
        <p className="text-[10px] text-text-dim">
          Gaussian-smoothed activity curve with adaptive window (wider for longer works). Peaks must rise <Tex>{String.raw`\geq 0.4\sigma`}</Tex> above their base. Valleys symmetric.
        </p>
      </S>
    </div>
  );
}

function ScoringTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Forces convert to grades calibrated against reference works across all three textual modes &mdash; narratives, papers, simulations &mdash; so a system-heavy paper and a fate-heavy narrative can sit on the same scale.
      </p>

      <S title="Grading" analogy="Single exponential — floor 8, dominance at reference, cap 25.">
        <Block tex={String.raw`g(\tilde{x}) = 25 - 17\,e^{-k\tilde{x}} \qquad k = \ln\!\tfrac{17}{4} \qquad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}`} />
        <Block tex={String.raw`\text{Overall} = g(\tilde{F}) + g(\tilde{W}) + g(\tilde{S}) + g(\tilde{\text{Sw}})`} />
        <p className="text-[10px] text-text-dim">
          At <Tex>{String.raw`\tilde{x} = 1`}</Tex> (matching reference mean), grade = 21/25 &mdash; the dominance threshold. Floor 8, cap 25. Each force is divided by its own reference mean before grading so system-heavy papers, fate-heavy narratives, and world-heavy memoirs all land on the same scale. Swing graded directly against its own reference.
        </p>
        <div className="mt-2 flex gap-2 text-[10px]">
          {[
            { label: 'Fate', value: String(FORCE_REFERENCE_MEANS.fate), color: '#EF4444' },
            { label: 'World', value: String(FORCE_REFERENCE_MEANS.world), color: '#22C55E' },
            { label: 'System', value: String(FORCE_REFERENCE_MEANS.system), color: '#3B82F6' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/8">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-text-dim">{label}</span>
              <span className="font-mono text-text-secondary">{value}</span>
            </div>
          ))}
        </div>
      </S>
    </div>
  );
}

export function FormulaModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('Forces');

  return (
    <Modal onClose={onClose} size="2xl">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </ModalHeader>
      <ModalBody className="px-5 py-4">
        {tab === 'Forces' && <ForcesTab />}
        {tab === 'Dynamics' && <DynamicsTab />}
        {tab === 'Scoring' && <ScoringTab />}
      </ModalBody>
    </Modal>
  );
}
