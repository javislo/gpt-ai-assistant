// Must be the first import: sets a production-like Gemini env before config loads.
// eslint-disable-next-line import/order
import {
  DUMMY_GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GEMINI_MODEL,
  restoreEnv,
} from './setup/gemini-env.js';
import {
  afterAll, afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';
import axios from 'axios';
import { getPrompt, handleEvents, removePrompt } from '../app/index.js';
import { t } from '../locales/index.js';
import {
  EVENT_TYPE_MESSAGE, MESSAGE_TYPE_AUDIO, MESSAGE_TYPE_IMAGE, MESSAGE_TYPE_TEXT, SOURCE_TYPE_USER,
} from '../services/line.js';
import { TRANSCRIPTION_INSTRUCTION } from '../utils/generate-transcription.js';
import { PLAIN_TEXT_INSTRUCTION, toPlainText } from '../utils/generate-completion.js';
import { MOCK_USER_01, TIMEOUT } from './utils.js';

jest.mock('axios', () => jest.requireActual('./mocks/axios.js').default());

const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';
const GENERATE_CONTENT_URL = `/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MOCK_MESSAGE_ID = '100001';
const MOCK_REPLY_TOKEN = 'reply-token';
const MOCK_TRANSCRIPTION = '今天台北天氣如何';
const MOCK_REPLY = '今天台北晴時多雲。';
const MOCK_AUDIO_BYTES = Buffer.from('fake-m4a-audio');
const MOCK_IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const { clients } = axios;
const gemini = () => clients[GEMINI_BASE_URL];
const line = () => clients[LINE_API];
const lineData = () => clients[LINE_DATA_API];

const createEvent = (message) => ({
  replyToken: MOCK_REPLY_TOKEN,
  type: EVENT_TYPE_MESSAGE,
  source: { type: SOURCE_TYPE_USER, userId: MOCK_USER_01 },
  message: { id: MOCK_MESSAGE_ID, ...message },
});

const geminiResponse = (text, finishReason = 'STOP') => ({
  data: {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
  },
});

const isTranscriptionRequest = (body) => body.contents.some(({ parts }) => (
  parts.some(({ inlineData }) => inlineData?.mimeType?.startsWith('audio/'))
));

const geminiCalls = () => gemini().post.mock.calls;
const chatCalls = () => geminiCalls().filter(([, body]) => !isTranscriptionRequest(body));
const replies = () => line().post.mock.calls
  .filter(([url]) => url === '/v2/bot/message/reply')
  .map(([, body]) => body.messages.map(({ type, text }) => ({ type, text })));
const lastUserContent = (body) => body.contents.filter(({ role }) => role === 'user').pop();

beforeEach(() => {
  line().get.mockResolvedValue({ data: { displayName: 'user' } });
  line().post.mockResolvedValue({ data: {} });
  gemini().post.mockImplementation(async (url, body) => (
    isTranscriptionRequest(body) ? geminiResponse(MOCK_TRANSCRIPTION) : geminiResponse(MOCK_REPLY)
  ));
});

afterEach(() => {
  removePrompt(MOCK_USER_01);
  jest.clearAllMocks();
});

afterAll(() => {
  restoreEnv();
});

test('only the Gemini API is used, with the key in the x-goog-api-key header', () => {
  expect(Object.keys(clients)).not.toContain('https://api.openai.com');
  expect(Object.keys(clients).some((url) => url.includes('groq'))).toBe(false);

  const [[requestInterceptor]] = gemini().interceptors.request.use.mock.calls;
  const request = requestInterceptor({ headers: {}, url: GENERATE_CONTENT_URL });
  expect(request.headers['x-goog-api-key']).toEqual(DUMMY_GEMINI_API_KEY);
  expect(request.url).not.toContain(DUMMY_GEMINI_API_KEY);
});

test('text message: native generateContent request and text reply', async () => {
  await handleEvents([createEvent({ type: MESSAGE_TYPE_TEXT, text: '你好' })]);

  expect(geminiCalls()).toHaveLength(1);
  const [url, body] = geminiCalls()[0];
  expect(url).toEqual(GENERATE_CONTENT_URL);
  expect(url).not.toContain('/chat/completions');

  expect(body.systemInstruction.parts[0].text).toContain(t('__COMPLETION_DEFAULT_SYSTEM_PROMPT'));
  expect(body.systemInstruction.parts[0].text).toContain(PLAIN_TEXT_INSTRUCTION);
  body.contents.forEach(({ role, parts }) => {
    expect(['user', 'model']).toContain(role);
    expect(parts.length).toBeGreaterThan(0);
    parts.forEach((part) => expect(part.text).toBeTruthy());
  });
  expect(lastUserContent(body).parts).toEqual([{ text: '你好。' }]);
  expect(body.contents[body.contents.length - 1].role).toEqual('user');
  expect(body.generationConfig).toEqual({ temperature: 1, maxOutputTokens: 1024 });

  expect(replies()).toEqual([[{ type: 'text', text: MOCK_REPLY }]]);
}, TIMEOUT);

test('conversation memory: the previous exchange is sent on the next turn', async () => {
  await handleEvents([createEvent({ type: MESSAGE_TYPE_TEXT, text: '我叫小明' })]);
  await handleEvents([createEvent({ type: MESSAGE_TYPE_TEXT, text: '我叫什麼名字' })]);

  const [, body] = geminiCalls()[1];
  const texts = body.contents.map(({ role, parts }) => `${role}:${parts[0].text}`);
  expect(texts).toEqual(expect.arrayContaining([
    'user:我叫小明。',
    `model:${MOCK_REPLY}`,
    'user:我叫什麼名字。',
  ]));
  const { messages } = getPrompt(MOCK_USER_01);
  expect(messages[messages.length - 1].content).toEqual(MOCK_REPLY);
}, TIMEOUT);

test('image message: image is sent as inlineData to the vision model', async () => {
  lineData().get.mockResolvedValue({ data: MOCK_IMAGE_BYTES, headers: { 'content-type': 'image/png' } });

  await handleEvents([createEvent({ type: MESSAGE_TYPE_IMAGE })]);

  expect(lineData().get).toHaveBeenCalledWith(
    `/v2/bot/message/${MOCK_MESSAGE_ID}/content`,
    { responseType: 'arraybuffer' },
  );
  expect(geminiCalls()).toHaveLength(1);
  const [url, body] = geminiCalls()[0];
  expect(url).toEqual(GENERATE_CONTENT_URL);
  expect(lastUserContent(body).parts).toEqual([
    { text: t('__COMPLETION_VISION') },
    { inlineData: { mimeType: 'image/png', data: MOCK_IMAGE_BYTES.toString('base64') } },
  ]);
  expect(replies()).toEqual([[{ type: 'text', text: MOCK_REPLY }]]);
}, TIMEOUT);

test('audio message: receive → Gemini transcription → add to prompt → text reply', async () => {
  lineData().get.mockResolvedValue({ data: MOCK_AUDIO_BYTES, headers: { 'content-type': 'audio/x-m4a' } });

  await handleEvents([createEvent({ type: MESSAGE_TYPE_AUDIO })]);

  // 1. The voice message is downloaded from LINE.
  expect(lineData().get).toHaveBeenCalledWith(
    `/v2/bot/message/${MOCK_MESSAGE_ID}/content`,
    { responseType: 'arraybuffer' },
  );

  // 2. It is transcribed with Gemini audio understanding, not a Whisper endpoint.
  expect(geminiCalls()).toHaveLength(2);
  geminiCalls().forEach(([url]) => {
    expect(url).toEqual(GENERATE_CONTENT_URL);
    expect(url).not.toContain('/audio/transcriptions');
  });
  const [, transcriptionBody] = geminiCalls()[0];
  expect(transcriptionBody.contents).toEqual([
    {
      role: 'user',
      parts: [
        { text: TRANSCRIPTION_INSTRUCTION },
        { inlineData: { mimeType: 'audio/m4a', data: MOCK_AUDIO_BYTES.toString('base64') } },
      ],
    },
  ]);

  // 3. The transcription becomes the user message of the chat request.
  expect(chatCalls()).toHaveLength(1);
  const [, chatBody] = chatCalls()[0];
  expect(lastUserContent(chatBody).parts).toEqual([{ text: `${MOCK_TRANSCRIPTION}。` }]);

  // 4. The generated text is replied to LINE.
  expect(replies()).toEqual([[{ type: 'text', text: MOCK_REPLY }]]);
}, TIMEOUT);

test('free tier quota exceeded (429): stops without retrying or switching model', async () => {
  const err = new Error('Resource has been exhausted (e.g. check quota).');
  err.response = { status: 429, data: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } };
  gemini().post.mockRejectedValue(err);

  await handleEvents([createEvent({ type: MESSAGE_TYPE_TEXT, text: '你好' })]);

  expect(geminiCalls()).toHaveLength(1);
  expect(geminiCalls()[0][0]).toEqual(GENERATE_CONTENT_URL);
  expect(replies()).toEqual([[{ type: 'text', text: t('__ERROR_QUOTA_EXCEEDED') }]]);
}, TIMEOUT);

test('empty Gemini response is reported instead of sending a blank reply', async () => {
  gemini().post.mockResolvedValue({ data: { candidates: [{ finishReason: 'SAFETY' }] } });

  await handleEvents([createEvent({ type: MESSAGE_TYPE_TEXT, text: '你好' })]);

  expect(replies()).toEqual([[{ type: 'text', text: t('__ERROR_EMPTY_COMPLETION')('SAFETY') }]]);
}, TIMEOUT);

test('Markdown markers are removed because LINE shows replies as plain text', async () => {
  expect(toPlainText('請告訴我您的**地區**或**城市**喔！')).toEqual('請告訴我您的地區或城市喔！');
  expect(toPlainText('## 今日天氣\n* 多雲\n* 降雨機率 `20%`')).toEqual('今日天氣\n• 多雲\n• 降雨機率 20%');
  expect(toPlainText('2 * 3 = 6')).toEqual('2 * 3 = 6');

  gemini().post.mockResolvedValue(geminiResponse('**重點**：記得帶傘'));
  await handleEvents([createEvent({ type: MESSAGE_TYPE_TEXT, text: '你好' })]);
  expect(replies()).toEqual([[{ type: 'text', text: '重點：記得帶傘' }]]);
}, TIMEOUT);
