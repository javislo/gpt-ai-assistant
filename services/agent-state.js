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

// Read-only probe; uses exactly the same REST client as application state.
export const pingRedis = async () => (await redis('PING')) === 'PONG';

// Lease TTL is a little longer than the Vercel maxDuration (55 s), so a lease left by
// a crashed worker expires soon after the platform has stopped that invocation.
export const LEASE_TTL_SECONDS = 70;

export const ACQUIRE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'done' end
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 'busy' end
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('SET', KEYS[3], ARGV[1], 'EX', tonumber(ARGV[2]))
return 'acquired'
`;
export const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;
export const COMPLETE = `
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
  const status = await redis('EVAL', ACQUIRE, 3, ...keys, token, LEASE_TTL_SECONDS);
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

/**
 * Conversation state persisted per user: the Gemini prompt (memory) and the
 * history used by the summary/translation commands. Older records stored the
 * prompt messages as a bare array; they are still accepted.
 * @returns {Promise<{prompt: Array<Object>, history: Array<Object>}|null>}
 */
export const loadMemory = async (userId) => {
  const data = await redis('GET', key('memory', userId));
  if (!data) return null;
  const parsed = JSON.parse(data);
  if (Array.isArray(parsed)) return { prompt: parsed, history: [] };
  if (!parsed || !Array.isArray(parsed.prompt)) return null;
  return { prompt: parsed.prompt, history: Array.isArray(parsed.history) ? parsed.history : [] };
};

export const saveMemory = async (userId, prompt, history = []) => {
  await redis('SET', key('memory', userId), JSON.stringify({ prompt, history }), 'EX', 604800);
};

export const clearMemory = async (userId) => {
  await redis('DEL', key('memory', userId));
};

export const QUOTA = `
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

// App storage (user/group sources, including the bot's activated state).
// One Redis hash; each field is "<storage key>:<entry id>" so that writes for one
// user never overwrite another user's entry.
const STORAGE_KEY = 'line-agent:storage:v1';

export const isRedisConfigured = () => Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

export const loadStorageData = async () => {
  const flat = (await redis('HGETALL', STORAGE_KEY)) || [];
  const data = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const field = String(flat[i]);
    const separator = field.indexOf(':');
    if (separator > 0) {
      const name = field.slice(0, separator);
      data[name] = data[name] || {};
      data[name][field.slice(separator + 1)] = JSON.parse(flat[i + 1]);
    }
  }
  return data;
};

export const saveStorageItem = async (name, value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || name.includes(':')) {
    throw new Error(`Unsupported storage item: ${name}`);
  }
  const fields = Object.entries(value).flatMap(([id, entry]) => [`${name}:${id}`, JSON.stringify(entry)]);
  if (fields.length > 0) await redis('HSET', STORAGE_KEY, ...fields);
};

// Weather profiles (shared LINE location and morning-push subscription), one
// hash field per user.
const WEATHER_KEY = 'line-agent:weather:v1';

export const loadWeatherProfiles = async () => {
  const flat = (await redis('HGETALL', WEATHER_KEY)) || [];
  const profiles = {};
  for (let i = 0; i + 1 < flat.length; i += 2) profiles[flat[i]] = JSON.parse(flat[i + 1]);
  return profiles;
};

export const saveWeatherProfile = async (userId, profile) => {
  await redis('HSET', WEATHER_KEY, userId, JSON.stringify(profile));
};

export const eventFingerprint = (eventId) => hash(eventId);
