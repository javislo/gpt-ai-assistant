// Imported first by tests that exercise the real OpenAI-compatible request path.
// It must run before config/index.js is loaded, because config is frozen at import time.
// All network calls are mocked; the API key below is a dummy placeholder, not a real key.
export const ORIGINAL_ENV = { ...process.env };

export const GROQ_BASE_URL = 'https://api.groq.com/openai';
export const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';
export const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3';

Object.assign(process.env, {
  NODE_ENV: 'production',
  APP_LANG: 'zh_TW',
  OPENAI_API_KEY: 'dummy-test-key',
  OPENAI_BASE_URL: GROQ_BASE_URL,
  OPENAI_COMPLETION_MODEL: GROQ_CHAT_MODEL,
  OPENAI_VISION_MODEL: GROQ_VISION_MODEL,
  OPENAI_TRANSCRIPTION_MODEL: GROQ_TRANSCRIPTION_MODEL,
});
delete process.env.VERCEL_ACCESS_TOKEN;

export const restoreEnv = () => {
  Object.keys(process.env).forEach((key) => {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
};
