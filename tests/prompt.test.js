import { expect, test } from '@jest/globals';
import Prompt from '../app/prompt/prompt.js';
import { t } from '../locales/index.js';
import {
  PARTICIPANT_AI, PARTICIPANT_HUMAN, ROLE_ASSISTANT, ROLE_USER,
} from '../services/openai.js';

test('Prompt.toMessages maps participants to chat roles', () => {
  const prompt = new Prompt();
  prompt.write(PARTICIPANT_HUMAN, 'Hi').write(PARTICIPANT_AI);
  const messages = prompt.toMessages();
  expect(messages.map(({ role }) => role)).toEqual([ROLE_USER, ROLE_ASSISTANT, ROLE_USER]);
  expect(messages[messages.length - 1].content).toEqual('Hi');
});

test('Prompt.toMessages asks to continue a partial reply', () => {
  const prompt = new Prompt();
  prompt.write(PARTICIPANT_HUMAN, 'Hi').write(PARTICIPANT_AI, 'Hello').write('', 'sum');
  const messages = prompt.toMessages();
  expect(messages.slice(-2)).toEqual([
    { role: ROLE_ASSISTANT, content: 'Hello' },
    { role: ROLE_USER, content: t('__COMPLETION_CONTINUE') },
  ]);
});
