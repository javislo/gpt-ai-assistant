// Imported first by the async worker integration tests, before config loads.
// Every external service is mocked; all values below are dummy placeholders.
// LINE_ASYNC_ENABLED is set only inside this test process: deployments keep it false.
export const ORIGINAL_ENV = { ...process.env };

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const REDIS_URL = 'https://fake-redis.upstash.test';
export const WORKER_ORIGIN = 'https://preview.example.vercel.app';
export const WORKER_SECRET = 'test-worker-secret';
export const SIGNING_KEY = 'test-current-signing-key';
export const LINE_CHANNEL_SECRET = 'test-line-channel-secret';

Object.keys(process.env)
  .filter((key) => /^(GEMINI_|OPENAI_|QSTASH_|UPSTASH_|LINE_|VERCEL_)/.test(key))
  .forEach((key) => delete process.env[key]);

Object.assign(process.env, {
  NODE_ENV: 'production',
  APP_LANG: 'zh_TW',
  GEMINI_API_KEY: 'dummy-test-key',
  LINE_ASYNC_ENABLED: 'true',
  LINE_CHANNEL_SECRET,
  LINE_WORKER_ORIGIN: WORKER_ORIGIN,
  LINE_WORKER_SECRET: WORKER_SECRET,
  QSTASH_TOKEN: 'dummy-qstash-token',
  QSTASH_CURRENT_SIGNING_KEY: SIGNING_KEY,
  QSTASH_NEXT_SIGNING_KEY: 'test-next-signing-key',
  UPSTASH_REDIS_REST_URL: REDIS_URL,
  UPSTASH_REDIS_REST_TOKEN: 'dummy-redis-token',
  GEMINI_DAILY_REQUEST_LIMIT: '100',
  GEMINI_MINUTE_REQUEST_LIMIT: '50',
});

export const restoreEnv = () => {
  Object.keys(process.env).forEach((key) => {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
};
