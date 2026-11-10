const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const LockIcon = ({ locked }: { locked: boolean }) => (
  <svg {...base}>
    <rect x="4" y="11" width="16" height="10" rx="2" fill={locked ? "currentColor" : "none"} />
    <path d={locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-1.9"} />
  </svg>
);

export const TrashIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);

/** Filled crown for the "commander" / "the doc" labels; sized by the label's font. */
export const CrownIcon = () => (
  <svg className="crown-icon" viewBox="0 0 24 18" fill="currentColor" aria-hidden>
    <path d="M2 4.5l5.2 4.6L12 1.5l4.8 7.6L22 4.5 19.8 14H4.2z" />
    <rect x="4.2" y="15" width="15.6" height="2.6" rx="1" />
  </svg>
);
