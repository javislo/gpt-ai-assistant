import {
  afterAll, afterEach, beforeAll, expect, test,
} from '@jest/globals';
import app from '../api/notify.js';

let server;
let url;

const PREVIOUS = {};
const KEYS = ['AGENT_NOTIFICATIONS_ENABLED', 'AGENT_NOTIFY_SECRET', 'LINE_PUSH_USER_ID', 'LINE_CHANNEL_ACCESS_TOKEN'];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
});

afterEach(() => {
  KEYS.forEach((key) => {
    if (PREVIOUS[key] === undefined) delete process.env[key];
    else process.env[key] = PREVIOUS[key];
  });
});

const post = (path, headers, body) => fetch(`${url}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('disabled endpoint stays inaccessible at both Vercel and local paths', async () => {
  KEYS.forEach((key) => { PREVIOUS[key] = process.env[key]; });
  process.env.AGENT_NOTIFICATIONS_ENABLED = 'false';
  expect((await post('/api/notify', {}, {})).status).toBe(404);
  expect((await post('/', {}, {})).status).toBe(404);
});

test('does not expose an enabled but incomplete notification gateway', async () => {
  KEYS.forEach((key) => { PREVIOUS[key] = process.env[key]; });
  process.env.AGENT_NOTIFICATIONS_ENABLED = 'true';
  delete process.env.AGENT_NOTIFY_SECRET;
  expect((await post('/api/notify', {}, {})).status).toBe(503);
});

test('rejects unauthenticated requests and malformed message fields', async () => {
  KEYS.forEach((key) => { PREVIOUS[key] = process.env[key]; });
  const secret = 'a-valid-32-character-test-secret-long-enough';
  Object.assign(process.env, {
    AGENT_NOTIFICATIONS_ENABLED: 'true',
    AGENT_NOTIFY_SECRET: secret,
    LINE_PUSH_USER_ID: `U${'f'.repeat(32)}`,
    LINE_CHANNEL_ACCESS_TOKEN: 'dummy',
  });
  expect((await post('/api/notify', {}, { id: 'hi', text: 'hello' })).status).toBe(403);
  const resp = await post('/api/notify', { Authorization: `Bearer ${secret}` }, { id: 'bad id', text: 'hello' });
  expect(resp.status).toBe(400);
});
