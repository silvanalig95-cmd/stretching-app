// The browser's side of the optional AI coach. The Anthropic key never reaches the browser: serve.py holds it, takes the
// question, calls Claude and hands back the answer (see /api/llm in serve.py). This file is only the plumbing.

const HEADERS = { 'X-Unfurl': '1', 'Content-Type': 'application/json' };

export class CoachError extends Error {
  /** @param {string} message  something a person can read
   *  @param {string} [code]   no_key | daily_cap | invalid_key | busy | refused | too_long | bad_answer | unreachable | rejected | offline | empty */
  constructor(message, code = 'error') { super(message); this.name = 'CoachError'; this.code = code; }
}

let cached = null;

/** Is the coach set up? `null` when this page isn't talking to the server (so there is nothing that could hold a key). */
export async function llmStatus({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  try {
    const r = await fetch('/api/llm/status', { headers: { 'X-Unfurl': '1' } });
    if (!r.ok) return null;
    cached = await r.json();
    return cached;
  } catch { return null; }
}
export const forgetLlmStatus = () => { cached = null; };

/** Save or remove your own Anthropic key, or choose the model. Resolves to the new status. */
export async function llmSave(patch) {
  let r;
  try { r = await fetch('/api/llm/settings', { method: 'PUT', headers: HEADERS, body: JSON.stringify(patch) }); }
  catch { throw new CoachError('Could not reach the server.', 'offline'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new CoachError(body.error || 'Could not save that.', 'rejected');
  cached = body;
  return body;
}

/**
 * Ask Claude. `schema` is a JSON schema for the answer; the parsed answer comes back as `result`.
 * @returns {Promise<{result:any, text:string, model:string, usage:object}>}
 */
export async function askClaude({ system = '', prompt, schema = null, maxTokens = 8000 }) {
  let r;
  try { r = await fetch('/api/llm', { method: 'POST', headers: HEADERS, body: JSON.stringify({ system, prompt, schema, maxTokens }) }); }
  catch { throw new CoachError('Could not reach the server. Is it still running?', 'offline'); }
  const body = await r.json().catch(() => null);
  if (!r.ok || !body?.ok) throw new CoachError(body?.message || body?.error || `The coach could not answer (HTTP ${r.status}).`, body?.error || 'error');
  if (cached) cached = { ...cached, usedToday: (cached.usedToday ?? 0) + 1 };
  return body;
}
