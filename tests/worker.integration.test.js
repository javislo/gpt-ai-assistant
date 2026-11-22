// Must be the first import: sets the async-worker env before config loads.
// eslint-disable-next-line import/order
import {
  GEMINI_BASE_URL,
  GEMINI_MODEL,
  LINE_CHANNEL_SECRET,
  REDIS_URL,
  SIGNING_KEY,
  WORKER_ORIGIN,
  WORKER_SECRET,
  restoreEnv,
} from './setup/worker-env.js';
import { createHash, createHmac } from 'node:crypto';
import {
  afterAll, afterEach, beforeAll, beforeEach, expect, jest, test,
} from '@jest/globals';
import axios from 'axios';
import webhook from '../api/index.js';
import worker from '../api/worker.js';
import { COMMAND_BOT_DEACTIVATE } from '../app/commands/index.js';
import { removeHistory } from '../app/history/index.js';
import { removePrompt } from '../app/index.js';
import { t } from '../locales/index.js';
import { LEASE_TTL_SECONDS } from '../services/agent-state.js';
import storage from '../storage/index.js';
import { retryKeyForEvent } from '../utils/reply-message.js';
import { TRANSCRIPTION_INSTRUCTION } from '../utils/generate-transcription.js';
import createFakeRedis from './mocks/redis.js';

jest.mock('axios', () => jest.requireActual('./mocks/axios.js').default());

const USER = 'U-integration-user';
const WORKER_URL = `${WORKER_ORIGIN}/api/worker`;
const GENERATE_CONTENT_URL = `/v1beta/models/${GEMINI_MODEL}:generateContent`;
const TRANSCRIPT = '提醒我明天開會';

const realFetch = global.fetch;
const { clients } = axios;
const gemini = () => clients[GEMINI_BASE_URL];
const line = () => clients['https://api.line.me'];
const lineData = () => clients['https://api-data.line.me'];

let redis;
let qstashRequests;
let qstashStatus;
let workerServer;
let webhookServer;
let eventCounter = 0;

const listen = async (app) => {
  const server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  return server;
};
const urlOf = (server, path) => `http://127.0.0.1:${server.address().port}${path}`;

const signQstash = (body) => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'Upstash',
    sub: WORKER_URL,
    iat: now,
    nbf: now - 5,
    exp: now + 300,
    body: createHash('sha256').update(body).digest('base64url'),
  })).toString('base64url');
  const signature = createHmac('sha256', SIGNING_KEY).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const createEvent = (message, id) => {
  eventCounter += 1;
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now() + eventCounter,
    webhookEventId: id || `01EVENT${eventCounter}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `reply-${eventCounter}`,
    source: { type: 'user', userId: USER },
    message: { id: `m${eventCounter}`, ...message },
  };
};
const textEvent = (text, id) => createEvent({ type: 'text', text }, id);

/** Delivers an event to the worker the way QStash does (signed body + forwarded secret). */
const deliver = async (event) => {
  const body = JSON.stringify({ event });
  const res = await realFetch(urlOf(workerServer, '/api/worker'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-worker-key': WORKER_SECRET,
      'upstash-signature': signQstash(body),
    },
    body,
  });
  return res.status;
};

const geminiReply = (text) => ({
  data: { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] },
});
const isTranscription = (body) => body.contents.some(({ parts }) => (
  parts.some(({ inlineData }) => inlineData?.mimeType?.startsWith('audio/'))
));
const geminiCalls = () => gemini().post.mock.calls;
const chatCalls = () => geminiCalls().filter(([, body]) => !isTranscription(body));
const pushes = () => line().post.mock.calls.filter(([url]) => url === '/v2/bot/message/push');
const pushedTexts = () => pushes().map(([, body]) => body.messages.map(({ text }) => text));
const quotaCounters = () => ({
  day: Number(redis.store.get(redis.keysMatching('line-agent:quota:day:')[0]) || 0),
  minute: Number(redis.store.get(redis.keysMatching('line-agent:quota:minute:')[0]) || 0),
});

/** Simulates the next request landing on a fresh Vercel instance. */
const simulateNewInstance = () => {
  removePrompt(USER);
  removeHistory(USER);
  storage.data = {};
};

beforeAll(async () => {
  workerServer = await listen(worker);
  webhookServer = await listen(webhook);
});

afterAll(async () => {
  await new Promise((resolve) => { workerServer.close(resolve); });
  await new Promise((resolve) => { webhookServer.close(resolve); });
  restoreEnv();
});

beforeEach(() => {
  redis = createFakeRedis();
  qstashRequests = [];
  qstashStatus = 201;
  simulateNewInstance();
  global.fetch = jest.fn(async (url, init = {}) => {
    const target = String(url);
    if (target === REDIS_URL) {
      if (redis.down) throw new TypeError('fetch failed');
      return new globalThis.Response(JSON.stringify(redis.handle(init.body)), { status: 200 });
    }
    if (target.startsWith('https://qstash.upstash.io/')) {
      qstashRequests.push({ url: target, headers: init.headers, body: JSON.parse(init.body) });
      return new globalThis.Response(JSON.stringify({ messageId: `msg-${qstashRequests.length}` }), { status: qstashStatus });
    }
    if (target.startsWith('http://127.0.0.1')) return realFetch(url, init);
    throw new Error(`Unexpected network request: ${target}`);
  });
  line().get.mockResolvedValue({ data: { displayName: 'user' } });
  line().post.mockResolvedValue({ status: 200, data: {} });
  lineData().get.mockImplementation(async () => ({ data: Buffer.from('fake-m4a'), headers: { 'content-type': 'audio/x-m4a' } }));
  let replyCount = 0;
  gemini().post.mockImplementation(async (url, body) => {
    if (isTranscription(body)) return geminiReply(TRANSCRIPT);
    replyCount += 1;
    return geminiReply(`回覆${replyCount}`);
  });
});

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
  process.env.GEMINI_DAILY_REQUEST_LIMIT = '100';
  process.env.GEMINI_MINUTE_REQUEST_LIMIT = '50';
});

test('text message: one Gemini call, LINE push with retry key, state persisted in Redis', async () => {
  const event = textEvent('你好');
  expect(await deliver(event)).toEqual(200);

  expect(geminiCalls()).toHaveLength(1);
  expect(geminiCalls()[0][0]).toEqual(GENERATE_CONTENT_URL);
  expect(pushes()).toHaveLength(1);
  const [, body, options] = pushes()[0];
  expect(body).toEqual({ to: USER, messages: [expect.objectContaining({ type: 'text', text: '回覆1' })] });
  expect(options.headers['X-Line-Retry-Key']).toEqual(retryKeyForEvent(event.webhookEventId));

  expect(redis.keysMatching('line-agent:done:')).toHaveLength(1);
  expect(redis.keysMatching('line-agent:result:')).toHaveLength(1);
  expect(redis.keysMatching('line-agent:lease:')).toHaveLength(0);
  expect(redis.keysMatching('line-agent:user-lease:')).toHaveLength(0);
  const memory = JSON.parse(redis.store.get(redis.keysMatching('line-agent:memory:')[0]));
  expect(memory.prompt.map(({ content }) => content)).toEqual(expect.arrayContaining(['你好。', '回覆1']));
  expect(memory.history.length).toBeGreaterThan(0);
  const sources = await redis.handle(JSON.stringify(['HGETALL', 'line-agent:storage:v1'])).result;
  expect(sources[0]).toEqual(`sources:${USER}`);
});

test('worker uses a lease TTL just above the 55 s Vercel limit', () => {
  expect(LEASE_TTL_SECONDS).toBeGreaterThan(55);
  expect(LEASE_TTL_SECONDS).toBeLessThanOrEqual(120);
});

test('QStash redelivery of a completed event: no Gemini call, no second push', async () => {
  const event = textEvent('你好');
  expect(await deliver(event)).toEqual(200);
  expect(await deliver(event)).toEqual(200);

  expect(geminiCalls()).toHaveLength(1);
  expect(pushes()).toHaveLength(1);
});

test('worker interrupted after saving the reply: retry re-pushes it without calling Gemini', async () => {
  const event = textEvent('你好');
  line().post.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

  expect(await deliver(event)).toEqual(503);
  expect(redis.keysMatching('line-agent:result:')).toHaveLength(1);
  expect(redis.keysMatching('line-agent:done:')).toHaveLength(0);
  expect(redis.keysMatching('line-agent:user-lease:')).toHaveLength(0);

  expect(await deliver(event)).toEqual(200);
  expect(geminiCalls()).toHaveLength(1);
  expect(pushes()).toHaveLength(2);
  expect(pushes()[1][1]).toEqual(pushes()[0][1]);
  expect(pushes()[1][2].headers['X-Line-Retry-Key']).toEqual(pushes()[0][2].headers['X-Line-Retry-Key']);
});

test('LINE push 409 (retry key already accepted) completes the event', async () => {
  const event = textEvent('你好');
  line().post.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
  expect(await deliver(event)).toEqual(503);

  const conflict = Object.assign(new Error('Conflict'), { response: { status: 409, data: {} } });
  line().post.mockRejectedValueOnce(conflict);
  expect(await deliver(event)).toEqual(200);
  expect(redis.keysMatching('line-agent:done:')).toHaveLength(1);

  expect(await deliver(event)).toEqual(200);
  expect(geminiCalls()).toHaveLength(1);
  expect(pushes()).toHaveLength(2);
});

test('Redis unavailable: 503 for a QStash retry, and no Gemini call or push', async () => {
  redis.down = true;
  expect(await deliver(textEvent('你好'))).toEqual(503);
  expect(geminiCalls()).toHaveLength(0);
  expect(pushes()).toHaveLength(0);
});

test('Redis fails while handling: lease released and the retry succeeds', async () => {
  const event = textEvent('你好');
  const originalHandle = redis.handle.bind(redis);
  let failNextMemorySave = true;
  redis.handle = (body) => {
    const [command, k] = JSON.parse(body);
    if (failNextMemorySave && command === 'SET' && String(k).startsWith('line-agent:memory:')) {
      failNextMemorySave = false;
      throw new Error('Redis HTTP 500');
    }
    return originalHandle(body);
  };
  global.fetch.mockImplementation(async (url, init = {}) => {
    if (String(url) === REDIS_URL) {
      try {
        return new globalThis.Response(JSON.stringify(redis.handle(init.body)), { status: 200 });
      } catch {
        return new globalThis.Response('error', { status: 500 });
      }
    }
    return realFetch(url, init);
  });

  expect(await deliver(event)).toEqual(503);
  expect(pushes()).toHaveLength(0);
  expect(redis.keysMatching('line-agent:user-lease:')).toHaveLength(0);

  expect(await deliver(event)).toEqual(200);
  expect(pushes()).toHaveLength(1);
});

test('Gemini 429: user is told the quota is reached, event completes, no automatic retry', async () => {
  const error = Object.assign(new Error('Resource has been exhausted'), {
    response: { status: 429, data: { error: { status: 'RESOURCE_EXHAUSTED' } } },
  });
  gemini().post.mockRejectedValue(error);
  const event = textEvent('你好');

  expect(await deliver(event)).toEqual(200);
  expect(geminiCalls()).toHaveLength(1);
  expect(pushedTexts()).toEqual([[t('__ERROR_QUOTA_EXCEEDED')]]);
  expect(await deliver(event)).toEqual(200);
  expect(geminiCalls()).toHaveLength(1);
});

test('consecutive messages from one user: busy lease defers (no loss), order and memory kept', async () => {
  let releaseFirst;
  gemini().post.mockImplementationOnce(() => new Promise((resolve) => {
    releaseFirst = () => resolve(geminiReply('第一則回覆'));
  }));
  const first = textEvent('第一則');
  const second = textEvent('第二則');

  const firstStatus = deliver(first);
  while (geminiCalls().length < 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  // While the first message holds the user lease, the second is deferred to a
  // QStash retry instead of being processed out of order or dropped.
  expect(await deliver(second)).toEqual(503);
  expect(geminiCalls()).toHaveLength(1);

  releaseFirst();
  expect(await firstStatus).toEqual(200);
  simulateNewInstance();
  expect(await deliver(second)).toEqual(200);

  expect(pushedTexts()).toEqual([['第一則回覆'], ['回覆1']]);
  const [, secondBody] = geminiCalls()[1];
  const texts = secondBody.contents.map(({ role, parts }) => `${role}:${parts[0].text}`);
  const order = ['user:第一則。', 'model:第一則回覆', 'user:第二則。'].map((x) => texts.indexOf(x));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test('activated state persists across instances: deactivated bot stays silent', async () => {
  expect(await deliver(textEvent(COMMAND_BOT_DEACTIVATE.text))).toEqual(200);
  expect(pushedTexts()).toEqual([[COMMAND_BOT_DEACTIVATE.reply]]);

  simulateNewInstance();
  expect(await deliver(textEvent('你好'))).toEqual(200);
  expect(geminiCalls()).toHaveLength(0);
  expect(pushes()).toHaveLength(1);
});

test('conversation memory persists across instances', async () => {
  expect(await deliver(textEvent('我叫小明'))).toEqual(200);
  simulateNewInstance();
  expect(await deliver(textEvent('我叫什麼名字'))).toEqual(200);

  const [, body] = geminiCalls()[1];
  const texts = body.contents.map(({ role, parts }) => `${role}:${parts[0].text}`);
  expect(texts).toEqual(expect.arrayContaining(['user:我叫小明。', 'model:回覆1', 'user:我叫什麼名字。']));
});

test('shared limits count text, image and voice; voice counts transcription and answer', async () => {
  process.env.GEMINI_DAILY_REQUEST_LIMIT = '4';

  expect(await deliver(textEvent('你好'))).toEqual(200);
  expect(quotaCounters().day).toEqual(1);

  lineData().get.mockResolvedValueOnce({ data: Buffer.from([0xff, 0xd8]), headers: { 'content-type': 'image/jpeg' } });
  expect(await deliver(createEvent({ type: 'image' }))).toEqual(200);
  expect(quotaCounters().day).toEqual(2);

  expect(await deliver(createEvent({ type: 'audio', duration: 3000 }))).toEqual(200);
  expect(quotaCounters().day).toEqual(4);
  const [transcription] = geminiCalls().filter(([, body]) => isTranscription(body));
  expect(transcription[1].contents[0].parts[0].text).toEqual(TRANSCRIPTION_INSTRUCTION);
  expect(chatCalls()).toHaveLength(3);

  expect(await deliver(textEvent('還在嗎'))).toEqual(200);
  expect(geminiCalls()).toHaveLength(4);
  expect(quotaCounters().day).toEqual(4);
  expect(pushedTexts()[pushedTexts().length - 1]).toEqual([t('__ERROR_QUOTA_EXCEEDED')]);
});

test('per-minute limit: a voice message uses two calls, then further calls are blocked', async () => {
  process.env.GEMINI_MINUTE_REQUEST_LIMIT = '2';

  expect(await deliver(createEvent({ type: 'audio', duration: 3000 }))).toEqual(200);
  expect(quotaCounters().minute).toEqual(2);
  expect(geminiCalls()).toHaveLength(2);

  lineData().get.mockResolvedValueOnce({ data: Buffer.from([0xff, 0xd8]), headers: { 'content-type': 'image/jpeg' } });
  expect(await deliver(createEvent({ type: 'image' }))).toEqual(200);
  expect(geminiCalls()).toHaveLength(2);
  expect(pushedTexts()[pushedTexts().length - 1]).toEqual([t('__ERROR_QUOTA_EXCEEDED')]);
});

test('voice blocked at transcription: no answer call is attempted', async () => {
  process.env.GEMINI_DAILY_REQUEST_LIMIT = '1';
  expect(await deliver(textEvent('你好'))).toEqual(200);
  expect(await deliver(createEvent({ type: 'audio', duration: 3000 }))).toEqual(200);
  expect(geminiCalls()).toHaveLength(1);
  expect(pushedTexts()[1]).toEqual([t('__ERROR_QUOTA_EXCEEDED')]);
});

test('unsigned or tampered worker requests are rejected before any work', async () => {
  const body = JSON.stringify({ event: textEvent('你好') });
  const unsigned = await realFetch(urlOf(workerServer, '/api/worker'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-worker-key': WORKER_SECRET },
    body,
  });
  expect(unsigned.status).toEqual(403);
  const tampered = await realFetch(urlOf(workerServer, '/api/worker'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-worker-key': WORKER_SECRET,
      'upstash-signature': signQstash(body),
    },
    body: body.replace('你好', '惡意'),
  });
  expect(tampered.status).toEqual(403);
  expect(geminiCalls()).toHaveLength(0);
  expect(redis.commands).toHaveLength(0);
});

const postWebhook = (events) => {
  const body = JSON.stringify({ destination: 'U-bot', events });
  const signature = createHmac('sha256', LINE_CHANNEL_SECRET).update(body).digest('base64');
  return realFetch(urlOf(webhookServer, '/webhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body,
  });
};

test('webhook enqueues to the FIFO QStash queue in LINE order, then acknowledges', async () => {
  const first = textEvent('一');
  const second = textEvent('二');
  const group = { ...textEvent('群組'), source: { type: 'group', groupId: 'G1', userId: USER } };

  const res = await postWebhook([first, group, second]);
  expect(res.status).toEqual(200);
  expect(qstashRequests.map(({ body }) => body.event.webhookEventId))
    .toEqual([first.webhookEventId, second.webhookEventId]);
  qstashRequests.forEach(({ url, headers }) => {
    expect(url).toEqual(`https://qstash.upstash.io/v2/enqueue/line-agent/${WORKER_URL}`);
    expect(headers['Upstash-Deduplication-Id']).toMatch(/^line-event-[0-9a-f]{64}$/);
  });
  expect(geminiCalls()).toHaveLength(0);
});

test('webhook returns 500 when QStash rejects, so LINE can redeliver', async () => {
  qstashStatus = 500;
  const res = await postWebhook([textEvent('一'), textEvent('二')]);
  expect(res.status).toEqual(500);
  expect(qstashRequests).toHaveLength(1);
});
