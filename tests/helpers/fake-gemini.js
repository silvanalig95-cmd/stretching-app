// A stand-in for generativelanguage.googleapis.com, for the tests of the AI helper. It records every request it gets,
// checks the API key the way Google does (a wrong key is a 400 "API key not valid"), and answers with whatever the test
// has queued (or a plain successful answer). No real key or network is involved.
import http from 'node:http';

const DEFAULT_MODELS = [
  { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/text-bison-001', displayName: 'Not Gemini', supportedGenerationMethods: ['generateContent'] },
];

/**
 * @param {{keys?:string[], models?:object[], pageSize?:number}} [o] keys: the API keys it accepts (default: any)
 * @returns {Promise<{url:string, seen:Array<{method:string,path:string,headers:object,body:any}>, reply:(r:object)=>void, close:()=>void}>}
 */
export async function fakeGemini({ keys = null, models = DEFAULT_MODELS, pageSize = 100 } = {}) {
  const seen = [];
  const queue = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not JSON */ }
      seen.push({ method: req.method, path: req.url, headers: req.headers, body });
      const send = (status, doc) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof doc === 'string' ? doc : JSON.stringify(doc)); };
      if (keys && !keys.includes(req.headers['x-goog-api-key'])) return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/v1beta/models') {
        const start = Number(url.searchParams.get('pageToken') || 0);
        const page = models.slice(start, start + pageSize);
        return send(200, { models: page, ...(start + pageSize < models.length ? { nextPageToken: String(start + pageSize) } : {}) });
      }
      const m = url.pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/);
      if (req.method === 'POST' && m) {
        const r = queue.shift() ?? { text: JSON.stringify({ ok: true }) };
        if (r.raw !== undefined) return send(r.status ?? 200, r.raw);
        if ((r.status ?? 200) !== 200) return send(r.status, { error: { code: r.status, message: r.message ?? 'nope', status: r.errorStatus ?? 'ERROR' } });
        if (r.blockReason) return send(200, { promptFeedback: { blockReason: r.blockReason }, usageMetadata: { promptTokenCount: 10 } });
        const parts = [...(r.thought ? [{ text: r.thought, thought: true }] : []), ...(r.text === undefined ? [] : [{ text: r.text }])];
        return send(200, {
          candidates: [{ content: { role: 'model', parts }, finishReason: r.finish ?? 'STOP', ...(r.grounding ? { groundingMetadata: r.grounding } : {}) }],
          usageMetadata: { promptTokenCount: 4300, candidatesTokenCount: 700, totalTokenCount: 5000 }, modelVersion: m[1],
        });
      }
      send(404, { error: { code: 404, message: 'no such route', status: 'NOT_FOUND' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, reply: (r) => queue.push(r), close: () => server.close() };
}
