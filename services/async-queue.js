import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { eventFingerprint } from './agent-state.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing async queue configuration: ${name}`);
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

// Verify QStash's signed JWT against the exact raw request bytes and destination.
// A forwarded custom header alone would not authenticate the payload.
export const verifyQstashSignature = (jwt, body) => {
  if (typeof jwt !== 'string' || typeof body !== 'string') return false;
  try {
    const [header64, payload64, signature64, extra] = jwt.split('.');
    if (!header64 || !payload64 || !signature64 || extra) return false;
    const header = JSON.parse(Buffer.from(header64, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(payload64, 'base64url').toString());
    if (header.alg !== 'HS256' || payload.iss !== 'Upstash') return false;
    const dest = new URL('/api/worker', required('LINE_WORKER_ORIGIN')).toString();
    const now = Math.floor(Date.now() / 1000);
    if (payload.sub !== dest || typeof payload.exp !== 'number'
      || typeof payload.nbf !== 'number' || now >= payload.exp
      || now < payload.nbf || payload.exp - now > 3600) return false;
    const digest = createHash('sha256').update(body).digest('base64url');
    if (typeof payload.body !== 'string' || payload.body.replace(/=+$/, '') !== digest) return false;
    const signature = Buffer.from(signature64, 'base64url');
    return ['QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'].some((name) => {
      const secret = required(name);
      const expected = createHmac('sha256', secret)
        .update(`${header64}.${payload64}`).digest();
      return expected.length === signature.length && timingSafeEqual(expected, signature);
    });
  } catch {
    return false;
  }
};

export const enqueueEvent = async (event) => {
  const token = required('QSTASH_TOKEN');
  required('LINE_WORKER_SECRET');
  required('UPSTASH_REDIS_REST_URL');
  required('UPSTASH_REDIS_REST_TOKEN');
  const origin = required('LINE_WORKER_ORIGIN');
  const target = new URL('/api/worker', origin);
  if (target.protocol !== 'https:') throw new Error('Worker URL must use HTTPS');
  const endpoint = `https://qstash.upstash.io/v2/publish/${target.toString()}`;
  const id = event.webhookEventId;
  if (!id || typeof id !== 'string') throw new Error('LINE webhookEventId is required for deduplication');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Upstash-Forward-X-Agent-Worker-Key': process.env.LINE_WORKER_SECRET,
      'Upstash-Deduplication-Id': `line-event-${eventFingerprint(id)}`,
      'Upstash-Retries': '4',
    },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`QStash publish failed with status ${response.status}`);
  return response.json();
};
