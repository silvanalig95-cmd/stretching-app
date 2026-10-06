// Minimal accessible modal + toast.
import { h } from './dom.js';

export function openModal({ title, body, wide = false, onClose = null }) {
  const prevFocus = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (prevFocus?.focus) prevFocus.focus();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const titleId = `m${Math.random().toString(36).slice(2, 8)}`;
  const dialog = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header', null, h('h2', { id: titleId }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    body);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  (dialog.querySelector('[autofocus], button:not(.icon-btn), input, select') ?? dialog).focus();
  return { close, dialog };
}

export function toast(message, kind = 'info', ms = 4200) {
  let root = document.getElementById('toast-root');
  if (!root) { root = h('div', { id: 'toast-root', 'aria-live': 'polite', role: 'status' }); document.body.append(root); }
  const t = h('div', { class: `toast ${kind}` }, message);
  root.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? ms * 1.8 : ms);
  return t;
}
