import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { t } from '../locales/index.js';
import {
  FINISH_REASON_STOP,
  GEMINI_ROLE_MODEL,
  GEMINI_ROLE_USER,
  ROLE_AI,
  ROLE_SYSTEM,
  generateContent,
} from '../services/gemini.js';

class Completion {
  text;

  finishReason;

  constructor({
    text,
    finishReason,
  }) {
    this.text = text;
    this.finishReason = finishReason;
  }

  get isFinishReasonStop() {
    return this.finishReason === FINISH_REASON_STOP;
  }
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/s;

/**
 * Converts one prompt message content into Gemini parts.
 * @param {string|Array<Object>} content
 * @returns {Array<Object>}
 */
const toParts = (content) => {
  if (Array.isArray(content)) {
    return content.flatMap((item) => {
      if (item.type === 'text' && item.text) return [{ text: item.text }];
      if (item.type === 'image') return [{ inlineData: { mimeType: item.mimeType, data: item.data } }];
      return [];
    });
  }
  const text = String(content ?? '').trim();
  return text ? [{ text }] : [];
};

/**
 * Converts the app's prompt messages into a Gemini generateContent request.
 * System messages become systemInstruction; empty messages (such as the
 * placeholder assistant message waiting for this reply) are dropped.
 * @param {Array<Object>} messages
 */
const toGeminiRequest = (messages) => {
  const systemText = messages
    .filter(({ role }) => role === ROLE_SYSTEM)
    .map(({ content }) => String(content).trim())
    .filter(Boolean)
    .join('\n');
  const contents = messages
    .filter(({ role }) => role !== ROLE_SYSTEM)
    .map(({ role, content }) => ({
      role: role === ROLE_AI ? GEMINI_ROLE_MODEL : GEMINI_ROLE_USER,
      parts: toParts(content),
    }))
    .filter(({ parts }) => parts.length > 0);
  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents,
  };
};

const hasImage = (messages) => messages.some(({ content }) => (
  Array.isArray(content) && content.some(({ type }) => type === 'image')
));

const buildGenerationConfig = () => {
  const generationConfig = {
    temperature: config.GEMINI_TEMPERATURE,
    maxOutputTokens: config.GEMINI_MAX_OUTPUT_TOKENS,
  };
  if (config.GEMINI_THINKING_LEVEL) {
    generationConfig.thinkingConfig = { thinkingLevel: config.GEMINI_THINKING_LEVEL };
  }
  return generationConfig;
};

/**
 * Extracts the reply text from a generateContent response, skipping thought parts.
 * @param {Object} data
 * @returns {Completion}
 */
const toCompletion = (data) => {
  const [candidate] = data?.candidates || [];
  const text = (candidate?.content?.parts || [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
  if (!text) {
    const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || 'UNKNOWN';
    throw new Error(t('__ERROR_EMPTY_COMPLETION')(reason));
  }
  return new Completion({ text, finishReason: candidate.finishReason });
};

const assertApiKey = () => {
  if (!config.GEMINI_API_KEY) throw new Error(t('__ERROR_MISSING_ENV')('GEMINI_API_KEY'));
};

/**
 * @param {Object} param
 * @param {Prompt} param.prompt
 * @returns {Promise<Completion>}
 */
const generateCompletion = async ({
  prompt,
}) => {
  if (config.APP_ENV !== 'production') return new Completion({ text: MOCK_TEXT_OK });
  assertApiKey();
  const { messages } = prompt;
  const { systemInstruction, contents } = toGeminiRequest(messages);
  const { data } = await generateContent({
    model: hasImage(messages) ? config.GEMINI_VISION_MODEL : config.GEMINI_MODEL,
    systemInstruction,
    contents,
    generationConfig: buildGenerationConfig(),
  });
  return toCompletion(data);
};

export {
  assertApiKey,
  buildGenerationConfig,
  toCompletion,
  toGeminiRequest,
};

export default generateCompletion;
