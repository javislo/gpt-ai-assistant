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
// LINE shows replies as plain text, so Markdown markers would appear literally.
export const PLAIN_TEXT_INSTRUCTION = '回覆會顯示在 LINE 聊天室：請用純文字回答，不要使用 Markdown 符號（例如 **粗體**、# 標題、`程式碼`）。';

/**
 * Removes Markdown emphasis, headings and inline code markers that Gemini may
 * still produce, keeping the text itself.
 * @param {string} text
 * @returns {string}
 */
export const toPlainText = (text) => text
  .replace(/\*\*(.+?)\*\*/gs, '$1')
  .replace(/__(.+?)__/gs, '$1')
  .replace(/`([^`\n]+)`/g, '$1')
  .replace(/^#{1,6}[ \t]+/gm, '')
  .replace(/^[ \t]*\*[ \t]+/gm, '• ');

const toCompletion = (data) => {
  const [candidate] = data?.candidates || [];
  const raw = (candidate?.content?.parts || [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join('');
  const text = toPlainText(raw).trim();
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
  systemContext = '',
}) => {
  if (config.APP_ENV !== 'production') return new Completion({ text: MOCK_TEXT_OK });
  assertApiKey();
  const { messages } = prompt;
  const { systemInstruction: base, contents } = toGeminiRequest(messages);
  // Extra context for this request only (e.g. a weather forecast); it is not
  // written to the conversation memory.
  const systemText = [base?.parts?.[0]?.text, PLAIN_TEXT_INSTRUCTION, systemContext].filter(Boolean).join('\n\n');
  const systemInstruction = systemText ? { parts: [{ text: systemText }] } : undefined;
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
