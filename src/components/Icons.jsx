const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Arrow = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const ArrowDown = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M12 5v14M6 13l6 6 6-6" /></svg>
);
export const Chevron = ({ size = 14, open = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const Close = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Menu = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M4 8h16M4 16h16" /></svg>
);
export const Search = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
);
export const NoAlcohol = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /><path d="M4 4l16 16" /></svg>
);
export const CareDrop = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5s7 7.4 7 12.3a7 7 0 0 1-14 0c0-4.9 7-12.3 7-12.3z" fill="#D3262F" />
    <path d="M12 11v7M8.5 14.5h7" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
export const Swipe = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
);
export const Play = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
);
export const Pin = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const Locate = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
);
export const Info = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
);
export const Phone = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
);
export const External = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const Chat = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z" /></svg>
);
export const Flask = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" /><path d="M7.5 15h9" /></svg>
);
export const DocCheck = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 14l2 2 4-4" /></svg>
);
export const Shield = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const Plus = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const Check = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
