import {
  beforeAll, expect, jest, test,
} from '@jest/globals';
import axios from 'axios';
import config from '../config/index.js';
import { createAudioTranscriptions } from '../services/openai.js';

jest.mock('axios', () => jest.requireActual('./mocks/axios.js').default());

beforeAll(() => {
  // This test only means something when the variable is not set.
  expect(process.env.OPENAI_TRANSCRIPTION_MODEL).toBeUndefined();
});

test('OPENAI_TRANSCRIPTION_MODEL defaults to whisper-1 when unset', async () => {
  expect(config.OPENAI_TRANSCRIPTION_MODEL).toEqual('whisper-1');

  const client = axios.clients[config.OPENAI_BASE_URL];
  client.post.mockResolvedValue({ data: { text: 'ok' } });
  await createAudioTranscriptions({ buffer: Buffer.from('audio'), file: 'audio.m4a' });

  const [url, form] = client.post.mock.calls[0];
  expect(url).toEqual('/v1/audio/transcriptions');
  expect(form.toString()).toMatch(/name="model"\r\n\r\nwhisper-1\r\n/);
});
