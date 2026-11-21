import axios from 'axios';
import config from '../config/index.js';

export const PARTICIPANT_AI = 'AI';
export const PARTICIPANT_HUMAN = 'Human';

export const ROLE_SYSTEM = 'system';
export const ROLE_USER = 'user';
export const ROLE_ASSISTANT = 'assistant';

export const FINISH_REASON_STOP = 'stop';
export const FINISH_REASON_LENGTH = 'length';

export const IMAGE_SIZE_256 = '256x256';
export const IMAGE_SIZE_512 = '512x512';
export const IMAGE_SIZE_1024 = '1024x1024';

const instance = axios.create({
  baseURL: 'https://api.openai.com',
  timeout: config.OPENAI_TIMEOUT,
  headers: {
    'Accept-Encoding': 'gzip, deflate, compress',
  },
});

instance.interceptors.request.use((c) => {
  c.headers.Authorization = `Bearer ${config.OPENAI_API_KEY}`;
  return c;
});

const createChatCompletion = ({
  model = config.OPENAI_COMPLETION_MODEL,
  messages,
  temperature = config.OPENAI_COMPLETION_TEMPERATURE,
  maxTokens = config.OPENAI_COMPLETION_MAX_TOKENS,
  frequencyPenalty = config.OPENAI_COMPLETION_FREQUENCY_PENALTY,
  presencePenalty = config.OPENAI_COMPLETION_PRESENCE_PENALTY,
}) => instance.post('/v1/chat/completions', {
  model,
  messages,
  temperature,
  max_completion_tokens: maxTokens,
  frequency_penalty: frequencyPenalty,
  presence_penalty: presencePenalty,
});

const createImage = ({
  prompt,
  n = 1,
  size = IMAGE_SIZE_256,
}) => instance.post('/v1/images/generations', {
  prompt,
  n,
  size,
});

export {
  createChatCompletion,
  createImage,
};
