import axios from 'axios';
import config from '../config/index.js';
import { reserveModelCall } from './agent-state.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

// Roles used inside the app's prompt. They are mapped to Gemini roles per request.
export const ROLE_SYSTEM = 'system';
export const ROLE_AI = 'assistant';
export const ROLE_HUMAN = 'user';

export const GEMINI_ROLE_USER = 'user';
export const GEMINI_ROLE_MODEL = 'model';

export const FINISH_REASON_STOP = 'STOP';
export const FINISH_REASON_MAX_TOKENS = 'MAX_TOKENS';

const client = axios.create({
  baseURL: config.GEMINI_BASE_URL,
  timeout: config.GEMINI_TIMEOUT,
  headers: {
    'Accept-Encoding': 'gzip, deflate, compress',
  },
});

client.interceptors.request.use((c) => {
  // The key is sent as a header, never in the URL, so it does not end up in logs.
  c.headers['x-goog-api-key'] = config.GEMINI_API_KEY;
  return handleRequest(c);
});

client.interceptors.response.use(handleFulfilled, (err) => {
  if (err.response?.data?.error?.message) {
    err.message = err.response.data.error.message;
  }
  return handleRejected(err);
});

/**
 * Native Gemini API: POST /{version}/models/{model}:generateContent
 * @see https://ai.google.dev/api/generate-content
 * @param {Object} param
 * @param {string} param.model
 * @param {Array<Object>} param.contents
 * @param {Object} [param.systemInstruction]
 * @param {Object} [param.generationConfig]
 */
const generateContent = async ({
  model,
  contents,
  systemInstruction,
  generationConfig,
}) => {
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (generationConfig) body.generationConfig = generationConfig;
  await reserveModelCall();
  return client.post(`/${config.GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:generateContent`, body);
};

export {
  generateContent,
};
