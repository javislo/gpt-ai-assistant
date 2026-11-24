import { createHash, createHmac } from 'node:crypto';
import {
  afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';
import { verifyQstashSignature, verifyWorkerSecret, enqueueEvent } from '../services/async-queue.js';
import { retryKeyForEvent } from '../utils/reply-message.js';
import { withUsageMeter, reserveModelCall } from '../services/agent-state.js';

const previous = {};
const settings = {
  LINE_WORKER_ORIGIN: 'https://example.vercel.app',
  LINE_WORKER_SECRET: 'a-test-worker-secret',
  QSTASH_CURRENT_SIGNING_KEY: 'current-test-signature',
  QSTASH_NEXT_SIGNING_KEY: 'next-test-signature',
};
const savedFetch = global.fetch;

beforeEach(() => {
  Object.keys(settings).forEach((k) => { previous[k] = process.env[k]; process.env[k] = settings[k]; });
});

afterEach(() => {
  Object.keys(settings).forEach((k) => {
    if (previous[k] === undefined) delete process.env[k];
    else process.env[k] = previous[k];
  });
  global.fetch = savedFetch;
});

const sign = (body, overrides = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'Upstash',
    sub: 'https://example.vercel.app/api/worker',
    iat: now,
    nbf: now - 5,
    exp: now + 120,
    body: createHash('sha256').update(body).digest('base64url'),
    ...overrides,
  })).toString('base64url');
  const sig = createHmac('sha256', settings.QSTASH_CURRENT_SIGNING_KEY)
    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
};

test('verifies QStash JWT payload, destination and expiry', () => {
  const body = '{"event":{"webhookEventId":"test"}}';
  expect(verifyQstashSignature(sign(body), body)).toBe(true);
  expect(verifyQstashSignature(sign(body), `${body} `)).toBe(false);
  expect(verifyQstashSignature(sign(body, { sub: 'https://bad.example/api/worker' }), body)).toBe(false);
  expect(verifyQstashSignature(sign(body, { exp: 1 }), body)).toBe(false);
  expect(verifyQstashSignature('bad.jwt', body)).toBe(false);
});

test('refuses unauthenticated worker header', () => {
  expect(verifyWorkerSecret(settings.LINE_WORKER_SECRET)).toBe(true);
  expect(verifyWorkerSecret('wrong-secret')).toBe(false);
  expect(verifyWorkerSecret(undefined)).toBe(false);
});

test('LINE retry key is a stable UUID-style key per event', () => {
  expect(retryKeyForEvent('event-a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(retryKeyForEvent('event-a')).toBe(retryKeyForEvent('event-a'));
  expect(retryKeyForEvent('event-a')).not.toBe(retryKeyForEvent('event-b'));
});

test('model call quota fails closed when Redis is missing', async () => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    await expect(withUsageMeter(() => reserveModelCall())).rejects.toThrow('Upstash Redis is not configured');
  } finally {
    if (url !== undefined) process.env.UPSTASH_REDIS_REST_URL = url;
    if (token !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = token;
  }
});

test('cannot publish a queue message before credentials are configured', async () => {
  const token = process.env.QSTASH_TOKEN;
  delete process.env.QSTASH_TOKEN;
  try {
    await expect(enqueueEvent({ webhookEventId: 'event-a' })).rejects.toThrow('QSTASH_TOKEN');
  } finally {
    if (token !== undefined) process.env.QSTASH_TOKEN = token;
  }
});
