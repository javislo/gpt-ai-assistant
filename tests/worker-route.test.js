import {
  afterAll, beforeAll, expect, test,
} from '@jest/globals';
import worker from '../api/worker.js';

let server;
let baseUrl;

beforeAll(async () => {
  server = worker.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
});

// Vercel passes the full path (/api/worker) to the function. The request must reach
// the worker handler (which answers 404 "Not Found" while async mode is off),
// not Express's default "Cannot POST" page.
test.each(['/api/worker', '/'])('worker handler is reached at %s', async (path) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toEqual(404);
  expect(await res.text()).toEqual('Not Found');
});
