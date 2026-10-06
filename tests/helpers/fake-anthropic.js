// A stand-in for api.anthropic.com's /v1/messages, for the tests of the AI coach. It records every request it gets
// and answers with whatever the test has queued (or a plain successful answer).
import http from 'node:http';

/** @returns {Promise<{url:string, seen:Array<{headers:object, body:object}>, reply:(r:object)=>void, close:()=>void}>} */
export async function fakeAnthropic() {
  const seen = [];
  const queue = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not JSON */ }
      seen.push({ method: req.method, path: req.url, headers: req.headers, body });
      const r = queue.shift() ?? { text: JSON.stringify({ ok: true }) };
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      if (r.raw !== undefined) return res.end(r.raw);
      if ((r.status ?? 200) !== 200) return res.end(JSON.stringify({ type: 'error', error: { type: r.errorType ?? 'invalid_request_error', message: r.message ?? 'nope' } }));
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: body?.model ?? 'x', stop_reason: r.stop ?? 'end_turn',
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: r.text ?? '' }],
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, reply: (r) => queue.push(r), close: () => server.close() };
}
