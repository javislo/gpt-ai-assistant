import { createHmac, timingSafeEqual } from 'node:crypto';
import { eventFingerprint } from './agent-state.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error('Missing async queue configuration: ' + name);
  return value;
};

export const isAsyncEnabled = () => process.env.LINE_ASYNC_ENABLED === 'true';

export const verifyWorkerSecret = (provided) => {
  const secret = required('LINE_WORKER_SECRET');
  if (typeof provided !== 'string') return false;
  const actual = createHmac('sha256', secret).update('agent-worker').digest();
  const received = createHmac('sha256', provided).update('agent-worker').digest();
  return timingSafeEqual(actual, received);
};

export const enqueueEvent = async (event) => {
  const token = required('QSTASH_TOKEN');
  required('LINE_WORKER_SECRET');
  required('UPSTASH_REDIS_REST_URL');
  required('UPSTASH_REDIS_REST_TOKEN');
  const origin = required('LINE_WORKER_ORIGIN');
  const target = new URL('/api/worker', origin);
  if (target.protocol !== 'https:') throw new Error('Worker URL must use HTTPS');
  const endpoint = 'https://qstash.upstash.io/v2/publish/' + target.toString();
  const id = event.webhookEventId;
  if (!id || typeof id !== 'string') throw new Error('LINE webhookEventId is required for deduplication');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Upstash-Forward-X-Agent-Worker-Key': process.env.LINE_WORKER_SECRET,
      'Upstash-Deduplication-Id': 'line-event-' + eventFingerprint(id),
      'Upstash-Retries': '4',
    },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('QStash publish failed with status ' + response.status);
  return response.json();
};
