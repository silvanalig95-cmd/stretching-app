// Tiny DOM builder. Everything goes in as text nodes / attributes, never as
// HTML, so video titles and viewer comments (untrusted) can't inject markup.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k.startsWith('aria-')) { if (v != null) el.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['checked', 'disabled', 'value', 'selected', 'open', 'hidden'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}
/** Replace an element's children. Unlike the native replaceChildren it flattens arrays and skips null/false. */
export function fill(el, ...kids) {
  el.replaceChildren();
  return append(el, kids);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const fmtViews = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : `${n} views`);
export const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
