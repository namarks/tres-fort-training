// Line drawings standing in for the SF Symbols the app uses. Write
// <i data-icon="figure.run" data-size="20"></i> in a screen; render.mjs
// swaps in the SVG, colored by the element's CSS color.
const P = {
  'figure.pool.swim': '<circle cx="16" cy="6" r="2"/><path d="M5 13l5-4 3 3 3-2M3 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/>',
  'figure.core.training': '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M7 9.5l5 1.5 5-1.5M8.5 21l3.5-7 3.5 7"/>',
  'square.stack': '<rect x="5" y="8" width="14" height="13" rx="2.5"/><path d="M7 5h10M9 2.5h6"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'figure.strengthtraining.traditional': '<path d="M5 9v6M19 9v6M2.5 10.5v3M21.5 10.5v3M5 12h14"/>',
  'figure.run': '<circle cx="14" cy="4.5" r="2"/><path d="M7 21l3-6 3 2 1 5M10 15l1-5 4 2 3-1M11 10l-3 1-2 3"/>',
  'figure.walk': '<circle cx="13" cy="4.5" r="2"/><path d="M9 21l2-6 3 3v3M11 15l1-6 3 3 3 1M12 9l-3 2-1 3"/>',
  'bicycle': '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l3 7M9 6h3"/>',
  'figure.soccer': '<circle cx="12" cy="12" r="8"/><path d="M12 8l3 2-1 4h-4l-1-4z"/>',
  'square.and.pencil': '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  'list.bullet.clipboard': '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM8.5 11h7M8.5 15h7"/>',
  'clock.arrow.circlepath': '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  'person.2.fill': '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 19c.6-3.4 3-5 6-5s5.4 1.6 6 5M15 14.5c2.6-.3 5 1 5.6 4"/>',
  'person.crop.circle': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.4-2 3.3-3 5.5-3s4.1 1 5.5 3"/>',
  'chevron.right': '<path d="M9 5l7 7-7 7"/>',
  'chevron.left': '<path d="M15 5l-7 7 7 7"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'map': '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',
  'checkmark.circle.fill': '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  'ellipsis': '<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  'dumbbell': '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  'sportscourt': '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.6"/>',
  'moon.zzz': '<path d="M15 4a8 8 0 1 0 5 12.5A7 7 0 0 1 15 4z"/>',
  'checkmark': '<path d="M5 12.5l4.5 4.5L19 7"/>',
  'calendar': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  'airplane': '<path d="M3 13l7-2V5.5a2 2 0 0 1 4 0V11l7 2v2l-7-1.5V18l2 1.5V21l-4-1-4 1v-1.5l2-1.5v-4.5L3 15z"/>',
  'xmark': '<path d="M6 6l12 12M18 6L6 18"/>',
  'repeat': '<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>',
  'chevron.down': '<path d="M5 9l7 7 7-7"/>',
  'ellipsis.circle': '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="16" cy="12" r=".6"/>',
  'chart.line.uptrend.xyaxis': '<path d="M4 4v16h16"/><path d="M7 15l4-4 3 3 5-6"/>',
  'text.cursor': '<path d="M9 4h6M9 20h6M12 4v16"/>',
  'heart': '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  'text.bubble': '<path d="M4 5h16v11H9l-4 3v-3H4z"/><path d="M8 9h8M8 12h5"/>',
  'checkmark.shield': '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  'arrow.up.right.square': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 14l5-5M10.5 9H15v4.5"/>',
  'chevron.up.chevron.down': '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
};
export function icon(name, size = 20, weight = 1.9) {
  const body = P[name] ?? '<circle cx="12" cy="12" r="8"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
export function expandIcons(html) {
  return html.replace(/<i data-icon="([^"]+)"(?: data-size="(\d+)")?(?: data-weight="([\d.]+)")?><\/i>/g,
    (_, name, size, weight) => icon(name, size ? Number(size) : 20, weight ? Number(weight) : 1.9));
}
