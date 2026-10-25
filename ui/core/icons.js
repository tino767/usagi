// 24×24 glyphs drawn in currentColor. Modules pass one as `icon` for the
// position rail, and can use any of these in their own UI.

const s = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" ${extra}>${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
// Filled shapes with soft, rounded corners (transport controls).
const blob = 'fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"';

export const icons = {
  note: s('<path fill="currentColor" d="M20 3v12.5a3 3 0 1 1-2-2.83V7.2l-8 1.6v8.7a3 3 0 1 1-2-2.83V5.4L20 3z"/>'),
  timer: s('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.2 2M9.5 3h5"/>', stroke),
  notes: s('<path d="M6 3.5h8.5l3.5 3.5v13.5H6z"/><path d="M9.5 12h5M9.5 16h3"/>', stroke),
  grid: s('<g fill="currentColor"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2"/></g>'),
  speaker: s('<path fill="currentColor" d="M3.5 9h3.5l5-4.2v14.4l-5-4.2H3.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  prev: s(`<path ${blob} d="M21.7 3.9 10.3 12l11.4 8.1z"/><rect fill="currentColor" x=".8" y="2.4" width="6.4" height="19.2" rx="3.2"/>`),
  next: s(`<path ${blob} d="M2.3 3.9 13.7 12 2.3 20.1z"/><rect fill="currentColor" x="16.8" y="2.4" width="6.4" height="19.2" rx="3.2"/>`),
  play: s(`<path ${blob} d="M6.5 4.4 19.5 12 6.5 19.6z"/>`),
  pause: s('<rect fill="currentColor" x="2.4" y="2.4" width="6.4" height="19.2" rx="2.4"/><rect fill="currentColor" x="15.2" y="2.4" width="6.4" height="19.2" rx="2.4"/>'),
  stop: s('<rect fill="currentColor" x="4" y="4" width="16" height="16" rx="4"/>'),
  reset: s('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>', stroke),
  spark: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>', stroke),
  settings: s('<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.6" fill="currentColor"/><circle cx="15" cy="17" r="2.6" fill="currentColor"/>', stroke),
  appearance: s('<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/>', stroke),
  behavior: s('<path d="M8 3v12l3-3 2.5 6 2-1-2.5-6H17z"/>', stroke),
  ask: s('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01"/>', stroke),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', stroke),
  back: s('<path d="M15 5l-7 7 7 7"/>', stroke),
  search: s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', stroke),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>', stroke),
  plus: s('<path d="M12 5v14M5 12h14"/>', stroke),
};
