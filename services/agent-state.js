import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

const usageContext = new AsyncLocalStorage();
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const key = (type, id) => `line-agent:${type}:${hash(id)}`;

const redis = async (...command) => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !/^https:\/\//.test(url)) throw new Error('Upstash Redis is not configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error('Redis command rejected');
  return data.result;
};

const ACQUIRE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'done' end
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 'busy' end
redis.call('SET', KEYS[2], ARGV[1], 'EX', 120)
redis.call('SET', KEYS[3], ARGV[1], 'EX', 120)
return 'acquired'
`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;
const COMPLETE = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], '1', 'EX', 604800)
redis.call('DEL', KEYS[2])
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
return 1
`;

const eventKeys = (eventId, userId) => [
  key('done', eventId), key('lease', eventId), key('user-lease', userId),
];

export const acquireEvent = async (eventId, userId) => {
  const token = randomUUID();
  const keys = eventKeys(eventId, userId);
  const status = await redis('EVAL', ACQUIRE, 3, ...keys, token);
  return { status, token, keys };
};

export const releaseEvent = async ({ keys, token }) => {
  await redis('EVAL', RELEASE, 2, keys[1], keys[2], token);
};

export const completeEvent = async ({ keys, token }) => {
  const result = await redis('EVAL', COMPLETE, 3, ...keys, token);
  if (result !== 1) throw new Error('Event lease lost before completion');
};

export const loadResult = async (id) => {
  const data = await redis('GET', key('result', id));
  return data ? JSON.parse(data) : null;
};

export const saveResult = async (id, messages) => {
  await redis('SET', key('result', id), JSON.stringify(messages), 'EX', 604800);
};

export const loadMemory = async (userId) => {
  const data = await redis('GET', key('memory', userId));
  if (!data) return null;
  const messages = JSON.parse(data);
  return Array.isArray(messages) ? messages : null;
};

export const saveMemory = async (userId, messages) => {
  await redis('SET', key('memory', userId), JSON.stringify(messages), 'EX', 604800);
};

export const clearMemory = async (userId) => {
  await redis('DEL', key('memory', userId));
};

const QUOTA = `
local day = tonumber(redis.call('GET', KEYS[1]) or '0')
local minute = tonumber(redis.call('GET', KEYS[2]) or '0')
if day >= tonumber(ARGV[1]) then return -1 end
if minute >= tonumber(ARGV[2]) then return -2 end
day = redis.call('INCR', KEYS[1])
if day == 1 then redis.call('EXPIRE', KEYS[1], 172800) end
minute = redis.call('INCR', KEYS[2])
if minute == 1 then redis.call('EXPIRE', KEYS[2], 60) end
return day
`;

export const withUsageMeter = (callback) => usageContext.run({ enabled: true }, callback);

export const reserveModelCall = async () => {
  if (!usageContext.getStore()?.enabled) return; // Legacy path and isolated tests.
  const dayLimit = Number(process.env.GEMINI_DAILY_REQUEST_LIMIT || 8);
  const minuteLimit = Number(process.env.GEMINI_MINUTE_REQUEST_LIMIT || 4);
  if (!Number.isSafeInteger(dayLimit) || dayLimit < 1
    || !Number.isSafeInteger(minuteLimit) || minuteLimit < 2) {
    throw new Error('Invalid Gemini rate limit configuration');
  }
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const minute = Math.floor(Date.now() / 60000);
  const result = await redis(
    'EVAL',
    QUOTA,
    2,
    `line-agent:quota:day:${day}`,
    `line-agent:quota:minute:${minute}`,
    dayLimit,
    minuteLimit,
  );
  if (result < 0) {
    const error = new Error('Daily or per-minute Gemini request limit reached');
    error.response = { status: 429 };
    throw error;
  }
};

export const eventFingerprint = (eventId) => hash(eventId);
