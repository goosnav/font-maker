// Original 16-pixel toolbar artwork, drawn on an integer grid.
const paths: Record<string, string> = {
  undo: '<path fill="#244b20" d="M6 2v3h4v1h2v1h1v2h1v4h-3v-3h-1V9H6v3L1 7z"/><path fill="#5c9b43" d="M5 4v2h5v1h2v2h1v3h-1V9h-2V8H5v2L2 7z"/>',
  pencil: '<path fill="#202020" d="M11 1h3v1h1v3h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H8v1H7v1H6v1H2v-4h1V9h1V8h1V7h1V6h1V5h1V4h1V3h1V2h1z"/><path fill="#f4cb50" d="M10 4h1v1h1v1h-1v1h-1v1H9v1H8v1H7v1H6v1H4v-2h1V9h1V8h1V7h1V6h1V5h1z"/><path fill="#e88870" d="M12 2h2v2h-1V3h-1z"/><path fill="#fff3cd" d="M3 11h1v1h1v1H3z"/>',
  brush: '<path fill="#202020" d="M12 1h3v3h-1v2h-1v2h-1v2h-1v3H9v1H7v1H2v-1h1v-3h1V9h2V8h2V6h1V4h1V2h2z"/><path fill="#b47a38" d="M12 2h2v2h-1v2h-1v2h-2V6h1V4h1z"/><path fill="#eee" d="M8 8h3v2H7V9h1z"/><path fill="#535353" d="M5 10h2v3H4v-2h1z"/>',
  eraser: '<path fill="#202020" d="M6 3h6v1h1v1h1v1h1v4h-1v1h-1v1h-1v1H5v-1H4v-1H3v-1H2V7h1V6h1V5h1V4h1z"/><path fill="#ec8d8d" d="M6 4h5v1h1v1h1v1h-1v1h-1v1H6V8H5V7H4V6h1V5h1z"/><path fill="#fff" d="M3 7h1v1h1v1h1v1h5v2H5v-1H4v-1H3z"/><path fill="#aaa" d="M12 9h1V8h1v2h-1v1h-1z"/>',
  fill: '<path fill="#222" d="M4 1h3v1h1v3h1v1h1v1h1v1h1v2h-1v1h-1v1H9v1H7v-1H6v-1H5v-1H4V9H3V8H2V6h1V5h1V4h1V3H4z"/><path fill="#ddd" d="M6 4h1v2h1v1h1v1h1v1H4V8H3V6h1V5h2z"/><path fill="#397acd" d="M4 9h6v1H9v1H8v1H7v-1H6v-1H4zM13 10h1v2h1v2h-1v1h-2v-1h-1v-2h1v-1h1z"/>',
  line: '<path fill="#222" d="M12 2h2v2h-2v2h-2v2H8v2H6v2H4v2H2v-2h2v-2h2V8h2V6h2V4h2z"/>',
  rect: '<path fill="#222" fill-rule="evenodd" d="M2 3h12v10H2zm2 2v6h8V5z"/>',
  ellipse: '<path fill="#222" d="M5 2h6v1h2v2h1v6h-1v2h-2v1H5v-1H3v-2H2V5h1V3h2zm0 2v1H4v6h1v1h6v-1h1V5h-1V4z" fill-rule="evenodd"/>',
  select: '<path fill="#222" d="M2 2h3v1H3v2H2zm5 0h2v1H7zm4 0h3v3h-1V3h-2zM2 7h1v2H2zm11 0h1v2h-1zM2 11h1v2h2v1H2zm5 2h2v1H7zm6-2h1v3h-3v-1h2z"/>',
  save: '<path fill="#262626" d="M2 1h11v1h1v13H1V1z"/><path fill="#4e78b0" d="M2 2h11v12H2z"/><path fill="#ddd" d="M4 2h7v5H4zM4 9h7v5H4z"/><path fill="#333" d="M8 2h2v4H8zM5 10h5v1H5zM5 12h5v1H5z"/>',
};
export function icon(name: string) {
  return `<svg class="pixel-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" shape-rendering="crispEdges">${name === "redo" ? `<g transform="translate(16 0) scale(-1 1)">${paths.undo}</g>` : paths[name] ?? ""}</svg>`;
}
