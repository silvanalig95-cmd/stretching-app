// The fake YouTube Data API (fake-youtube.js) behind a real HTTP port, for tests where a separate process (serve.py's proxy, or the
// nightly sweep run by Node) has to reach it. Point UNFURL_YT_UPSTREAM at `url`.
import http from 'node:http';
import { handle, fault } from './fake-youtube.js';

export async function fakeYouTubeServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const { status, body } = handle(`http://fake.local${req.url}`);
    calls.push(new URL(req.url, 'http://x').pathname.split('/').pop());
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/youtube/v3`, calls, fault, close: () => server.close() };
}
