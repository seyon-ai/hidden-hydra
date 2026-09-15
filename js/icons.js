/**
 * icons.js — Hidden Hydra icon & avatar system
 * Replaces every UI emoji with crisp inline SVG line-art (gold-on-dark theme).
 * The sprite is injected into <body> at import time, so both static markup
 * (<svg><use href="#i-send"></use></svg>) and JS-built nodes work everywhere,
 * with zero network requests.
 */

const S = (id, inner) => `<symbol id="i-${id}" viewBox="0 0 24 24">${inner}</symbol>`;

const SPRITE =
  /* ── UI ── */
  S('send',    '<path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2"/>') +
  S('smile',   '<circle cx="12" cy="12" r="9"/><path d="M8.6 14a4.4 4.4 0 0 0 6.8 0"/><path d="M9 9.6h.01"/><path d="M15 9.6h.01"/>') +
  S('image',   '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.6" cy="9.4" r="1.6"/><path d="M21 15.5 16.4 11 6 20"/>') +
  S('camera',  '<path d="M22 18.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.6"/>') +
  S('search',  '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>') +
  S('user',    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>') +
  S('users',   '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>') +
  S('logout',  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>') +
  S('back',    '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>') +
  S('x',       '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>') +
  S('plus',    '<path d="M12 5v14"/><path d="M5 12h14"/>') +
  S('info',    '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-5"/><path d="M12 7.6h.01"/>') +
  S('lock',    '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2.4"/>') +
  S('unlock',  '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>') +
  S('globe',   '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.7-4-9s1.5-6.4 4-9z"/>') +
  S('copy',    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>') +
  S('reply',   '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5V19"/>') +
  S('trash',   '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>') +
  S('check',   '<path d="M20 6 9 17l-5-5"/>') +
  S('menu',    '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>') +
  S('panel-left',  '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>') +
  S('panel-right', '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14.5 4v16"/>') +
  S('shield',  '<path d="M12 22s8-3.6 8-10V5.2L12 2 4 5.2V12c0 6.4 8 10 8 10z"/><path d="M9 11.5l2.2 2.2L15.5 9"/>') +
  S('key',     '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.6 12.4 21 2"/><path d="M17.5 5.5l3 3"/><path d="M14 9l2.4 2.4"/>') +
  S('eye',     '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>') +
  S('sparkles','<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M5 2.8l.6 1.5 1.5.6-1.5.6L5 7l-.6-1.5-1.5-.6 1.5-.6z"/>') +
  S('msg',     '<path d="M21 11.8a8.6 8.6 0 0 1-8.7 8.5 9.3 9.3 0 0 1-3.9-.85L3 21l1.6-5.1a8.3 8.3 0 0 1-1-4A8.6 8.6 0 0 1 12.3 3.3 8.6 8.6 0 0 1 21 11.8z"/>') +
  S('zap',     '<path d="M13 2 3.5 14H12l-1 8L20.5 10H12l1-8z"/>') +
  S('heart',   '<path d="M20.7 6.6a5.3 5.3 0 0 0-7.6 0L12 7.7l-1.1-1.1a5.3 5.3 0 0 0-7.6 7.6l1.1 1.1L12 22l7.6-6.7 1.1-1.1a5.3 5.3 0 0 0 0-7.6z"/>') +
  S('gamepad', '<path d="M6.5 7h11A4.5 4.5 0 0 1 22 11.5v2A4.5 4.5 0 0 1 17.5 18c-1.6 0-2.6-.8-3.4-1.6h-4.2C9.1 17.2 8.1 18 6.5 18A4.5 4.5 0 0 1 2 13.5v-2A4.5 4.5 0 0 1 6.5 7z"/><path d="M7.5 10.5v4"/><path d="M5.5 12.5h4"/><path d="M15.8 11.4h.01"/><path d="M18.2 13.6h.01"/>') +
  S('rocket',  '<path d="M12 2.5c3.4 2.2 5.4 5.9 5.4 10.2l3.1 3.2-3.6 1-2 3.4-1.7-2.6h-2.4l-1.7 2.6-2-3.4-3.6-1 3.1-3.2C6.6 8.4 8.6 4.7 12 2.5z"/><circle cx="12" cy="10.4" r="2.2"/>') +
  S('music',   '<path d="M9 18V5.5L21 3v12.5"/><circle cx="6.2" cy="18" r="2.8"/><circle cx="18.2" cy="15.5" r="2.8"/>') +
  S('palette', '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.1-.9 2.1-2s-.9-1.7-.9-2.6c0-1.1.9-2 2-2h2.4A3.4 3.4 0 0 0 21 11a9 9 0 0 0-9-8z"/><circle cx="7.6" cy="10.6" r=".9" fill="currentColor" stroke="none"/><circle cx="11" cy="7.4" r=".9" fill="currentColor" stroke="none"/><circle cx="15.2" cy="8.4" r=".9" fill="currentColor" stroke="none"/>') +
  S('flame',   '<path d="M12 2.5s6 5.3 6 10a6 6 0 0 1-12 0c0-1.9.7-3.7 1.8-5.4 1.2 2 2.2 2.9 2.7 2.9-.4-2.6.4-5.3 1.5-7.5z"/><path d="M12 21.5a3 3 0 0 0 3-3c0-1.7-1.4-3-3-4.5-1.6 1.5-3 2.8-3 4.5a3 3 0 0 0 3 3z"/>') +
  S('star',    '<path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z"/>') +
  S('moon',    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>') +
  S('gem',     '<path d="M6.5 3h11L21.5 9 12 21 2.5 9z"/><path d="M2.5 9h19"/><path d="M12 21 8.5 9l2.2-6"/><path d="M12 21l3.5-12-2.2-6"/>') +
  S('wave',    '<path d="M2 9.5c2.5-3.2 5-3.2 7.5 0s5 3.2 7.5 0 3.6-2.6 5-.6"/><path d="M2 15.5c2.5-3.2 5-3.2 7.5 0s5 3.2 7.5 0 3.6-2.6 5-.6"/>') +
  S('refresh', '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>') +
  S('alert',   '<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5"/><path d="M12 17.4h.01"/>') +
  S('help',    '<circle cx="12" cy="12" r="9"/><path d="M9.4 9a2.7 2.7 0 0 1 5.3.8c0 1.8-2.7 2.4-2.7 3.7"/><path d="M12 17.2h.01"/>') +
  S('book',    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>') +
  S('chev-down','<path d="M6 9l6 6 6-6"/>') +
  S('chev-left','<path d="M15 18l-6-6 6-6"/>') +
  S('chev-right','<path d="M9 18l6-6-6-6"/>') +
  S('download','<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>') +
  S('jump',    '<path d="M12 5v13"/><path d="M6 12l6 6 6-6"/>') +

  /* ── reactions ── */
  S('r-thumb', '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>') +
  S('r-laugh', '<circle cx="12" cy="12" r="9"/><path d="M7.6 13h8.8a4.4 4.4 0 0 1-8.8 0z"/><path d="M7.8 9.2c.6-.8 1.7-.8 2.3 0"/><path d="M13.9 9.2c.6-.8 1.7-.8 2.3 0"/>') +
  S('r-wow',   '<circle cx="12" cy="12" r="9"/><path d="M9 9.4h.01"/><path d="M15 9.4h.01"/><circle cx="12" cy="15" r="1.9"/>') +
  S('r-sad',   '<circle cx="12" cy="12" r="9"/><path d="M8.6 16.4a4.4 4.4 0 0 1 6.8 0"/><path d="M9 9.6h.01"/><path d="M15 9.6h.01"/>') +
  S('r-clap',  '<path d="M9 3.6c1.9 0 3 1.6 3 3.7S10.6 14 9 14 6 9.4 6 7.3s1.1-3.7 3-3.7z"/><path d="M15 3.6c-1.9 0-3 1.6-3 3.7S13.4 14 15 14s3-4.6 3-6.7-1.1-3.7-3-3.7z"/><path d="M4 17h4.5"/><path d="M15.5 17H20"/><path d="M9.8 20.4h4.4"/>') +
  S('r-party', '<path d="M4.5 19.5 8 7l9 9z"/><path d="M13.5 4.5h.01"/><path d="M17.5 7.5h.01"/><path d="M19.5 3.5h.01"/><path d="M16 11c2.2.2 3.6-.8 4-3"/><path d="M9 15c1.4 1.6 3 2.4 5 2.4"/>') +

  /* ── avatar emblems (20) ── */
  S('av-dragon','<path d="M12 3.2c1.6 1.2 2.6 2.8 2.9 4.6l3.6-1.6-2 3.6c1.5 1.5 2.3 3.4 2.3 5.6 0 3.4-2.9 5.6-6.8 5.6s-6.8-2.2-6.8-5.6c0-2.2.8-4.1 2.3-5.6l-2-3.6 3.6 1.6c.3-1.8 1.3-3.4 2.9-4.6z"/><path d="M9.6 12.4h.01"/><path d="M14.4 12.4h.01"/><path d="M10.4 16.6c1 .8 2.2.8 3.2 0"/><path d="M9.1 7.8 7.6 5.4"/><path d="M14.9 7.8l1.5-2.4"/>') +
  S('av-fox','<path d="M4 4.5 8 7h8l4-2.5-1 6.5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10z"/><path d="M9.4 12h.01"/><path d="M14.6 12h.01"/><path d="M12 15.4v1.4"/><path d="M10.6 17.6c.9.6 1.9.6 2.8 0"/>') +
  S('av-wolf','<path d="M4.5 3.5 8.5 7h7l4-3.5-.6 7c0 4.6-3 8.7-6.9 10.5-3.9-1.8-6.9-5.9-6.9-10.5z"/><path d="M9.3 11.6l1.2 1"/><path d="M14.7 11.6l-1.2 1"/><path d="M12 15.6l-1.3 1.6h2.6z"/>') +
  S('av-lion','<circle cx="12" cy="12" r="4.6"/><path d="M12 2.6v2.6"/><path d="M12 18.8v2.6"/><path d="M2.6 12h2.6"/><path d="M18.8 12h2.6"/><path d="M5.4 5.4l1.9 1.9"/><path d="M16.7 16.7l1.9 1.9"/><path d="M18.6 5.4l-1.9 1.9"/><path d="M7.3 16.7l-1.9 1.9"/><path d="M10.4 11.4h.01"/><path d="M13.6 11.4h.01"/><path d="M12 13.4v1.2"/><path d="M10.9 15.4c.7.5 1.5.5 2.2 0"/>') +
  S('av-tiger','<circle cx="12" cy="12.6" r="6.4"/><path d="M7.4 7.4 6 4.4l3 1.2"/><path d="M16.6 7.4 18 4.4l-3 1.2"/><path d="M6 11.4h2.4"/><path d="M15.6 11.4H18"/><path d="M6.6 14.6h2.2"/><path d="M15.2 14.6h2.2"/><path d="M10.6 11.8h.01"/><path d="M13.4 11.8h.01"/><path d="M12 14.4v1.4"/><path d="M10.8 16.6c.8.5 1.6.5 2.4 0"/>') +
  S('av-butterfly','<path d="M12 6.5v11"/><path d="M12 8.5C10.5 5 8 3.5 5.5 4 3 4.6 2.4 8 4 10.4c-2.2 1.4-2.6 4.6-.6 6.1 2.2 1.6 5.6.3 8.6-3.5"/><path d="M12 8.5C13.5 5 16 3.5 18.5 4c2.5.6 3.1 4 1.5 6.4 2.2 1.4 2.6 4.6.6 6.1-2.2 1.6-5.6.3-8.6-3.5"/><path d="M10.6 4.6 9.4 3"/><path d="M13.4 4.6 14.6 3"/>') +
  S('av-flame','<path d="M12 2.6s6.2 5.5 6.2 10.3a6.2 6.2 0 0 1-12.4 0c0-2 .8-3.8 1.9-5.6 1.2 2.1 2.3 3 2.8 3-.4-2.7.4-5.4 1.5-7.7z"/><path d="M12 21.4a3.1 3.1 0 0 0 3.1-3.1c0-1.8-1.5-3.1-3.1-4.7-1.6 1.6-3.1 2.9-3.1 4.7a3.1 3.1 0 0 0 3.1 3.1z"/>') +
  S('av-bolt','<path d="M13 2 3.5 14H12l-1 8L20.5 10H12l1-8z"/>') +
  S('av-moon','<path d="M20.5 13.2A8.8 8.8 0 1 1 10.8 3.5a7 7 0 0 0 9.7 9.7z"/><path d="M17.5 5.5h.01"/><path d="M20 8.5h.01"/>') +
  S('av-gem','<path d="M6.5 3.5h11L21.5 9.5 12 21 2.5 9.5z"/><path d="M2.5 9.5h19"/><path d="M12 21 8.5 9.5l2.2-6"/><path d="M12 21l3.5-11.5-2.2-6"/>') +
  S('av-wave','<path d="M2.5 8.5c2.4-3 4.8-3 7.2 0s4.8 3 7.2 0 3.4-2.5 4.6-.6"/><path d="M2.5 13c2.4-3 4.8-3 7.2 0s4.8 3 7.2 0 3.4-2.5 4.6-.6"/><path d="M2.5 17.5c2.4-3 4.8-3 7.2 0s4.8 3 7.2 0 3.4-2.5 4.6-.6"/>') +
  S('av-eagle','<path d="M21.5 5.5c-4.2.5-7.3 2.6-8.9 6.2C11 8.1 7.9 6 3.7 5.5c2.6 2.1 4.2 4.7 4.7 8.3.3 2.5 1.7 4.6 3.6 6.2 1.9-1.6 3.3-3.7 3.6-6.2.5-3.6 2.1-6.2 5.9-8.3z"/><path d="M12 13.5v6.5"/>') +
  S('av-dolphin','<path d="M3.5 13.5c0-4.2 4.2-7.3 9.3-7.3 2 0 3.9.5 5.4 1.4-.8.7-1.3 1.5-1.4 2.4 1.9.5 3.1 1.5 3.7 3-1.9-.5-3.5-.5-4.9 0-1.9 4.7-6.6 6.3-10.6 4.6 1.4-.5 2.4-1.4 2.9-2.8-1.5-.3-3-.7-4.4-1.3z"/><path d="M15.6 9.4h.01"/><path d="M6 17.6 3.5 21"/>') +
  S('av-raccoon','<circle cx="12" cy="13" r="7.5"/><path d="M7.2 6.6 6 3.6l3 1.4"/><path d="M16.8 6.6 18 3.6l-3 1.4"/><path d="M4.8 11.4c2.4-1.2 4.8-1.2 7.2 0 2.4-1.2 4.8-1.2 7.2 0"/><path d="M4.8 14.2c2.4 1.2 4.8 1.2 7.2 0 2.4 1.2 4.8 1.2 7.2 0"/><path d="M9.6 12.8h.01"/><path d="M14.4 12.8h.01"/><path d="M12 15.6v1.2"/>') +
  S('av-masks','<path d="M3.5 4.5h8v7.2a4 4 0 0 1-8 0z"/><path d="M5.8 8h.01"/><path d="M9.2 8h.01"/><path d="M6 10.4c1.2 1 2.8 1 4 0"/><path d="M12.5 8h8v7.2a4 4 0 0 1-8 0z"/><path d="M14.8 11.5h.01"/><path d="M18.2 11.5h.01"/><path d="M14.7 15.4c1.2-1 2.8-1 4 0"/>') +
  S('av-blossom','<circle cx="12" cy="12" r="2.1"/><circle cx="12" cy="6.4" r="2.6"/><circle cx="17.3" cy="10.2" r="2.6"/><circle cx="15.3" cy="16.5" r="2.6"/><circle cx="8.7" cy="16.5" r="2.6"/><circle cx="6.7" cy="10.2" r="2.6"/>') +
  S('av-octopus','<path d="M6 12.5a6 6 0 0 1 12 0"/><path d="M6 12.5c.2 3-1 5.2-3 6.5"/><path d="M9.6 12.5c0 3-.6 5.2-2.1 7"/><path d="M14.4 12.5c0 3 .6 5.2 2.1 7"/><path d="M18 12.5c-.2 3 1 5.2 3 6.5"/><path d="M9.8 10.4h.01"/><path d="M14.2 10.4h.01"/>') +
  S('av-unicorn','<path d="M14.5 3 17 7"/><path d="M9.5 21c-2.8-2.2-3.9-6-2.9-9.2l1.6-4.6 2.6 1.9h3.6l1.8-2.1.9 6.6c.9 2.9.1 6-1.9 8.4z"/><path d="M12.6 11.6h.01"/><path d="M8.2 12.6c1.2-.6 2.4-.6 3.6 0"/>') +
  S('av-star','<path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z"/>') +
  S('av-sword','<path d="M20.5 3.5 9.5 14.5"/><path d="M20.5 3.5h-3.4"/><path d="M20.5 3.5v3.4"/><path d="M7 12l5 5"/><path d="M9.5 14.5 6 18"/><path d="M5 16.5 3.5 20.5 7.5 19"/><path d="M13 17.5 16.5 21"/>');

/* inject sprite once */
if (typeof document !== 'undefined' && !document.getElementById('hh-sprite')) {
  const d = document.createElement('div');
  d.id = 'hh-sprite';
  d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  d.setAttribute('aria-hidden', 'true');
  d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${SPRITE}</svg>`;
  (document.body || document.documentElement).appendChild(d);
}

/** HTML string for an icon: icon('send') → '<svg class="icon ..."><use href="#i-send"/></svg>' */
export function icon(name, cls = '', size = 18) {
  return `<svg class="icon ${cls}" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/** DOM element version */
export function iconEl(name, cls = '', size = 18) {
  const w = document.createElement('span');
  w.innerHTML = icon(name, cls, size);
  return w.firstElementChild;
}

/* ── legacy emoji → icon id maps (old profiles/rooms keep working) ── */
export const AVATARS = ['dragon','fox','wolf','lion','tiger','butterfly','flame','bolt','moon','gem','wave','eagle','dolphin','raccoon','masks','blossom','octopus','unicorn','star','sword'];

const LEGACY_AV = {
  '🐉':'dragon','🦊':'fox','🐺':'wolf','🦁':'lion','🐯':'tiger','🦋':'butterfly','🔥':'flame','⚡':'bolt',
  '🌙':'moon','💎':'gem','🌊':'wave','🦅':'eagle','🐬':'dolphin','🦝':'raccoon','🎭':'masks','🌸':'blossom',
  '🐙':'octopus','🦄':'unicorn','⭐':'star','🗡️':'sword','🤖':'sparkles','🌍':'globe','🎮':'gamepad',
  '🚀':'rocket','🎵':'music','🎨':'palette','👥':'users','💬':'msg','📸':'camera'
};

/** resolve any stored avatar value (new id or legacy emoji) to an icon id */
export function avatarId(v) {
  if (!v) return 'dragon';
  if (AVATARS.includes(v)) return 'av-' + v;
  if (LEGACY_AV[v]) return 'av-' + LEGACY_AV[v];
  return 'av-dragon';
}

/** room/group icon resolver */
export function roomIconId(g) {
  if (g.id === 'g-ai-assistant' || g.id?.startsWith?.('ai-')) return 'sparkles';
  const map = { 'g-lounge':'globe','g-gaming':'gamepad','g-tech':'rocket','g-music':'music','g-creative':'palette' };
  if (map[g.id]) return map[g.id];
  if (g.icon && AVATARS.includes(g.icon)) return 'av-' + g.icon;
  if (LEGACY_AV[g.icon]) return 'av-' + LEGACY_AV[LEGACY_AV[g.icon]];
  return 'star';
}

/* ── reactions ── */
export const REACTIONS = [
  { id:'r-thumb', legacy:'👍' }, { id:'heart',  legacy:'❤️' }, { id:'r-laugh', legacy:'😂' },
  { id:'r-wow',   legacy:'😮' }, { id:'r-sad', legacy:'😢' }, { id:'flame',  legacy:'🔥' },
  { id:'r-clap',  legacy:'👏' }, { id:'r-party',legacy:'🎉' }
];
const LEGACY_REACT = Object.fromEntries(REACTIONS.map(r => [r.legacy, r.id]));
export function reactionIconId(key) { return LEGACY_REACT[key] || key; }

/* ── country flags → real flag images (flagcdn) with graceful fallback ── */
const RI = /[\u{1F1E6}-\u{1F1FF}]{2}/u;   // regional-indicator pair = flag emoji
export function countryCode(str) {
  const m = String(str || '').match(RI);
  if (!m) return null;
  const cps = [...m[0]].map(c => c.codePointAt(0) - 0x1F1E6 + 65);
  return String.fromCharCode(cps[0], cps[1]).toLowerCase();
}
export function countryName(str) {
  return String(str || '').replace(RI, '').replace(/^[^\w]*/, '').trim() || String(str || '');
}
/** <img> tag for a flag; falls back to the emoji/text if offline */
export function flagImg(str, size = 18) {
  const cc = countryCode(str);
  const name = countryName(str);
  if (!cc) return `<span class="ctry">${esc2(str || '')}</span>`;
  return `<img class="flag" width="${size}" height="${Math.round(size * 0.75)}" loading="lazy"
    src="https://flagcdn.com/w40/${cc}.png" alt="${esc2(name)}" title="${esc2(name)}"
    onerror="this.outerHTML='<span class=&quot;ctry&quot;>${esc2(str)}</span>'">`;
}
function esc2(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
