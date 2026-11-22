// Imported first by tests that exercise the real Gemini request path.
// It must run before config/index.js is loaded, because config is frozen at import time.
// All network calls are mocked; the key below is a dummy placeholder, not a real key.
export const ORIGINAL_ENV = { ...process.env };

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DUMMY_GEMINI_API_KEY = 'dummy-test-key';

Object.keys(process.env)
  .filter((key) => key.startsWith('GEMINI_') || key.startsWith('OPENAI_') || key === 'VERCEL_ACCESS_TOKEN')
  .forEach((key) => delete process.env[key]);

Object.assign(process.env, {
  NODE_ENV: 'production',
  APP_LANG: 'zh_TW',
  GEMINI_API_KEY: DUMMY_GEMINI_API_KEY,
});

export const restoreEnv = () => {
  Object.keys(process.env).forEach((key) => {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
};
