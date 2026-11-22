import {
  afterEach, beforeEach, expect, test,
} from '@jest/globals';
import { handleEvents, getPrompt, removePrompt } from '../app/index.js';
import { COMMAND_BOT_DRAW } from '../app/commands/index.js';
import { t } from '../locales/index.js';
import {
  createEvents, TIMEOUT, MOCK_USER_01,
} from './utils.js';

beforeEach(() => {
  //
});

afterEach(() => {
  removePrompt(MOCK_USER_01);
});

test('COMMAND_BOT_DRAW', async () => {
  const events = [
    ...createEvents([`${COMMAND_BOT_DRAW.text}人工智慧`]),
  ];
  let results;
  try {
    results = await handleEvents(events);
  } catch (err) {
    console.error(err);
  }
  // Image generation is disabled on the Gemini free tier: nothing is generated
  // or written to the prompt, and the user is told the feature is off.
  expect(getPrompt(MOCK_USER_01).messages.length).toEqual(3);
  const replies = results.map(({ messages }) => messages.map(({ type, text }) => ({ type, text })));
  expect(replies).toEqual(
    [
      [{ type: 'text', text: t('__ERROR_IMAGE_GENERATION_DISABLED') }],
    ],
  );
}, TIMEOUT);
