// A teacher's (channel's) name as a link to their page: their videos, what they teach, and finding more of them.
// It is a real link (so it can be opened in a new tab), and a plain click goes there without leaving the app.

import { h } from '../dom.js';
import { ctx } from '../ctx.js';

/** The address of a teacher's page. */
export const teacherHref = (name) => `#teacher/${encodeURIComponent(name)}`;

/**
 * @param {{channel?:string, channelId?:string, name?:string}|string} who  a video (or anything with a channel name), or the name itself
 * @param {{cls?:string, text?:string|Node}} [o]
 * @returns {HTMLElement|null} null when there is no name to link to
 */
export function teacherLink(who, { cls = '', text } = {}) {
  const name = String((typeof who === 'string' ? who : who?.channel || who?.name || who?.channelId) ?? '').trim();
  if (!name) return null;
  return h('a', {
    class: `teacher-link ${cls}`.trim(), href: teacherHref(name), 'data-teacher-link': name,
    title: `${name}: their videos, what they teach, and more of them`,
    onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // a new tab / window is the browser's business
      e.preventDefault(); e.stopPropagation();
      ctx.hooks.openTeacher(name);
    },
  }, text ?? name);
}
