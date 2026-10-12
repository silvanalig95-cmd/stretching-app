// The browser's side of the optional AI helper. The Gemini key never reaches the browser: serve.py holds it, takes the question,
// calls Google and hands back the answer (see /api/gemini in serve.py). This file is only the plumbing.

const HEADERS = { 'X-Unfurl': '1', 'Content-Type': 'application/json' };

export class AIError extends Error {
  /** @param {string} message  something a person can read
   *  @param {string} [code]   no_key | daily_cap | invalid_key | model | busy | refused | too_long | empty | bad_answer | unreachable | rejected | offline */
  constructor(message, code = 'error') { super(message); this.name = 'AIError'; this.code = code; }
}

let cached = null;

/** Is the helper set up? `null` when this page isn't talking to the server (so there is nothing that could hold a key). */
export async function aiStatus({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  try {
    const r = await fetch('/api/gemini/status', { headers: { 'X-Unfurl': '1' } });
    if (!r.ok) return null;
    cached = await r.json();
    return cached;
  } catch { return null; }
}
export const forgetAiStatus = () => { cached = null; };
/** The last status that was fetched (no network), or null. */
export const aiStatusNow = () => cached;

/** Save or remove your own Gemini key, or choose the model. Resolves to the new status. */
export async function aiSave(patch) {
  let r;
  try { r = await fetch('/api/gemini/settings', { method: 'PUT', headers: HEADERS, body: JSON.stringify(patch) }); }
  catch { throw new AIError('Could not reach the server.', 'offline'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new AIError(body.error || 'Could not save that.', 'rejected');
  cached = body;
  return body;
}

/** The models Google lists for this key: [{id, displayName}]. */
export async function aiModels() {
  let r;
  try { r = await fetch('/api/gemini/models', { headers: { 'X-Unfurl': '1' } }); }
  catch { throw new AIError('Could not reach the server.', 'offline'); }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new AIError(body?.message || body?.error || `Google didn’t list its models (HTTP ${r.status}).`, body?.error || 'error');
  return body.models ?? [];
}

/**
 * Ask Gemini. `video` is a YouTube video id for it to watch; `search` grounds the answer in Google Search.
 * @returns {Promise<{text:string, model:string, finishReason:string, sources:{uri:string,title:string}[], queries:string[], usage:object}>}
 */
export async function askGemini({ system = '', prompt, video = null, search = false, json = true, maxTokens = 8000, lowRes = true }) {
  let r;
  try { r = await fetch('/api/gemini/generate', { method: 'POST', headers: HEADERS, body: JSON.stringify({ system, prompt, video, search, json, maxTokens, lowRes }) }); }
  catch { throw new AIError('Could not reach the server. Is it still running?', 'offline'); }
  const body = await r.json().catch(() => null);
  if (!r.ok || !body?.ok) throw new AIError(body?.message || body?.error || `Gemini could not answer (HTTP ${r.status}).`, body?.error || 'error');
  if (cached) cached = { ...cached, usedToday: (cached.usedToday ?? 0) + 1 };
  return body;
}
