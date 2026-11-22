// Must be the first import: sets an OpenAI-compatible (Groq) env before config loads.
// eslint-disable-next-line import/order
import {
  GROQ_BASE_URL,
  GROQ_CHAT_MODEL,
  GROQ_TRANSCRIPTION_MODEL,
  GROQ_VISION_MODEL,
  restoreEnv,
} from './setup/groq-env.js';
import {
  afterAll, afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';
import axios from 'axios';
import { getPrompt, handleEvents, removePrompt } from '../app/index.js';
import { ROLE_HUMAN } from '../services/openai.js';
import {
  EVENT_TYPE_MESSAGE, MESSAGE_TYPE_AUDIO, MESSAGE_TYPE_IMAGE, SOURCE_TYPE_USER,
} from '../services/line.js';
import { MOCK_USER_01, TIMEOUT } from './utils.js';

jest.mock('axios', () => jest.requireActual('./mocks/axios.js').default());

const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';

const MOCK_MESSAGE_ID = '100001';
const MOCK_REPLY_TOKEN = 'reply-token';
const MOCK_TRANSCRIPTION = '今天台北天氣如何';
const MOCK_COMPLETION = '今天台北晴時多雲。';
const MOCK_IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const { clients } = axios;
const groq = () => clients[GROQ_BASE_URL];
const line = () => clients[LINE_API];
const lineData = () => clients[LINE_DATA_API];

const createMediaEvent = (type) => ({
  replyToken: MOCK_REPLY_TOKEN,
  type: EVENT_TYPE_MESSAGE,
  source: { type: SOURCE_TYPE_USER, userId: MOCK_USER_01 },
  message: { id: MOCK_MESSAGE_ID, type },
});

const findCall = (client, url) => client.post.mock.calls.find(([path]) => path === url);

beforeEach(() => {
  line().get.mockResolvedValue({ data: { displayName: 'user' } });
  line().post.mockResolvedValue({ data: {} });
  groq().post.mockImplementation(async (url) => {
    if (url === '/v1/audio/transcriptions') return { data: { text: MOCK_TRANSCRIPTION } };
    if (url === '/v1/chat/completions') {
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: MOCK_COMPLETION }, finish_reason: 'stop' }],
        },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  removePrompt(MOCK_USER_01);
  jest.clearAllMocks();
});

afterAll(() => {
  restoreEnv();
});

test('audio message: receive → transcribe → add to prompt → reply with text', async () => {
  lineData().get.mockResolvedValue({ data: Buffer.from('fake-m4a-audio') });

  await handleEvents([createMediaEvent(MESSAGE_TYPE_AUDIO)]);

  // 1. The audio content is downloaded from LINE.
  expect(lineData().get).toHaveBeenCalledWith(
    `/v2/bot/message/${MOCK_MESSAGE_ID}/content`,
    { responseType: 'arraybuffer' },
  );

  // 2. It is sent to the transcription endpoint with the configured model.
  const transcriptionCall = findCall(groq(), '/v1/audio/transcriptions');
  expect(transcriptionCall).toBeDefined();
  const form = transcriptionCall[1].toString();
  expect(form).toContain('name="model"');
  expect(form).toContain(GROQ_TRANSCRIPTION_MODEL);
  expect(form).toContain('fake-m4a-audio');
  expect(transcriptionCall[2].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);

  // 3. The transcription is written as the user message of the chat completion.
  const completionCall = findCall(groq(), '/v1/chat/completions');
  expect(completionCall).toBeDefined();
  const body = completionCall[1];
  expect(body.model).toEqual(GROQ_CHAT_MODEL);
  const userMessage = body.messages[body.messages.length - 2];
  expect(userMessage.role).toEqual(ROLE_HUMAN);
  expect(typeof userMessage.content).toEqual('string');
  expect(userMessage.content).toContain(MOCK_TRANSCRIPTION);

  // 4. The generated text is replied to LINE and kept in the prompt.
  const replyCall = findCall(line(), '/v2/bot/message/reply');
  expect(replyCall).toBeDefined();
  expect(replyCall[1].replyToken).toEqual(MOCK_REPLY_TOKEN);
  expect(replyCall[1].messages.map(({ type, text }) => ({ type, text }))).toEqual([
    { type: 'text', text: MOCK_COMPLETION },
  ]);
  const { messages } = getPrompt(MOCK_USER_01);
  expect(messages[messages.length - 1].content).toEqual(MOCK_COMPLETION);
}, TIMEOUT);

test('image message: chat completion uses image_url content with the vision model', async () => {
  lineData().get.mockResolvedValue({ data: MOCK_IMAGE_BYTES });

  await handleEvents([createMediaEvent(MESSAGE_TYPE_IMAGE)]);

  expect(findCall(groq(), '/v1/audio/transcriptions')).toBeUndefined();
  const completionCall = findCall(groq(), '/v1/chat/completions');
  expect(completionCall).toBeDefined();
  const body = completionCall[1];
  expect(body.model).toEqual(GROQ_VISION_MODEL);
  const userMessage = body.messages[body.messages.length - 2];
  expect(userMessage.role).toEqual(ROLE_HUMAN);
  expect(userMessage.content).toEqual([
    { type: 'text', text: expect.any(String) },
    {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${MOCK_IMAGE_BYTES.toString('base64')}` },
    },
  ]);

  const replyCall = findCall(line(), '/v2/bot/message/reply');
  expect(replyCall[1].messages[0].text).toEqual(MOCK_COMPLETION);
}, TIMEOUT);
