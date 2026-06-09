/** Content icons — document, book, notepad, image, eye, location, people, question, dollar, settings, dice. */

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const defaults = (size = 12): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 },
});

export function IconDocument({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M16 13H8M16 17H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconBook({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconNotepad({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconImage({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEye({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconLocationPin({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconPeople({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconQuestion({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconDollar({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSettings({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDice({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function IconSearch({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2.5" />
      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconCompass({ size, ...rest }: P) {
  // Classic navigation compass — ring + a NE/SW needle. Marks the Compass
  // surface (variable scenarios) in the inspector rail.
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <polygon
        points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function IconList({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconFlask({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M9 2v6l-5 10a1 1 0 00.9 1.4h14.2a1 1 0 00.9-1.4L15 8V2M9 2h6M7 16h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAutoLoop({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} viewBox="0 0 16 16" {...rest}>
      <path d="M1 8a7 7 0 0112.5-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 8a7 7 0 01-12.5 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="13.5 1 13.5 4 10.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="2.5 15 2.5 12 5.5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function IconScorecard({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 7v10M12 7v10M16 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconLineChart({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 16l4-8 4 4 4-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconGlobe({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconThread({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M12 2v20M6 6l6 6 6-6M6 18l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconNetwork({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="6" cy="6" r="2" fill="currentColor" />
      <circle cx="18" cy="6" r="2" fill="currentColor" />
      <circle cx="6" cy="18" r="2" fill="currentColor" />
      <circle cx="18" cy="18" r="2" fill="currentColor" />
      <path d="M10.5 10.5L7.5 7.5M13.5 10.5L16.5 7.5M10.5 13.5L7.5 16.5M13.5 13.5L16.5 16.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function IconBelief({ size, ...rest }: P) {
  // Rising step-chart glyph — reads as the world view's belief evolving
  // over time, stance by stance, in the spirit of probability dashboards.
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <path d="M3 16v-4h4v-3h4v6h4v-4h4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function IconMind({ size, ...rest }: P) {
  // Abstract spark-of-thought glyph — a single four-point sparkle. Reads as
  // "Mind" without the biology: the seat where belief / present / compass /
  // mode converge.
  return (
    <svg {...defaults(size)} {...rest}>
      <path
        d="M12 3 Q13.2 10.8 21 12 Q13.2 13.2 12 21 Q10.8 13.2 3 12 Q10.8 10.8 12 3 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function IconWaveform({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 12h2l2-8 4 16 4-12 2 4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function IconSignals({ size, ...rest }: P) {
  // Broadcast/radiating signal — a source emitting concentric waves: the
  // perspectives' priors streaming in.
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <path d="M8.3 8.3a5.2 5.2 0 000 7.4M15.7 8.3a5.2 5.2 0 010 7.4M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function IconContent({ size, ...rest }: P) {
  // A stack of authored artifacts — the Content cluster (Plan / Prose / Audio
  // / Questions): the move rendered in its several forms.
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="8" y="3" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M16 19a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function IconPlan({ size, ...rest }: P) {
  // A clipboard/blueprint — the beat plan's structured outline, distinct from
  // the flowing page of Prose (IconDocument) and the raw notes of Entry.
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="9" y="2.5" width="6" height="3.4" rx="1.2" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M8.5 11h7M8.5 15h4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconProse({ size, ...rest }: P) {
  // Raw paragraph lines — the flowing written text of Prose (no page frame),
  // distinct from the Plan clipboard and the Entry notepad.
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M4 6h16M4 10.5h16M4 15h16M4 19.5h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCurriculum({ size, ...rest }: P) {
  // A graduation cap — the learning curriculum (a course of study), legible at
  // small sizes and distinct from Knowledge (lightbulb) / Coverage (ring).
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M12 4 21.5 8.5 12 13 2.5 8.5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <path d="M6.5 10.4v3.7c0 1.3 2.46 2.4 5.5 2.4s5.5-1.1 5.5-2.4v-3.7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <path d="M21.5 8.5v4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="21.5" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconCoverage({ size, ...rest }: P) {
  // A progress ring — how much of the question bank has been covered.
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" fill="none" />
      <path d="M12 4a8 8 0 016.93 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M9 12.5l2 2 4-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function IconLightbulb({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M9 18h6M10 22h4M12 2a6 6 0 014 10.5V16a1 1 0 01-1 1H9a1 1 0 01-1-1v-3.5A6 6 0 0112 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUser({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconUsers({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconMapPin({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconGitBranch({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <line x1="6" y1="3" x2="6" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="6" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M18 9a9 9 0 01-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBox({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDatabase({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="2" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" stroke="currentColor" strokeWidth="2" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconSystem({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconChat({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFolder({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconReasoning({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      {/* Brain/reasoning icon - nodes with connections */}
      <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 7.5L10 10M14 10L16.5 7.5M7.5 16.5L10 14M14 14L16.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
