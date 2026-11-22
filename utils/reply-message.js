import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import config from '../config/index.js';
import { reply, push } from '../services/line.js';
import { saveResult, saveMemory } from '../services/agent-state.js';

const delivery = new AsyncLocalStorage();
export const withAsyncDelivery = (state, callback) => delivery.run(state, callback);

export const retryKeyForEvent = (id) => {
  const h = createHash('sha256').update(String(id)).digest('hex').slice(0, 32)
    .split('');
  h[12] = '4';
  h[16] = '89ab'[parseInt(h[16], 16) % 4];
  const s = h.join('');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-');
};

const replyMessage = async ({
  replyToken,
  messages,
}) => {
  if (config.APP_ENV !== 'production') return { replyToken, messages };
  const state = delivery.getStore();
  if (!state) return reply({ replyToken, messages });
  // Persist the result before attempting delivery. A retried worker can replay
  // the same LINE push with the same retry key without regenerating Gemini text.
  await saveMemory(state.userId, state.getPrompt().messages);
  await saveResult(state.eventId, messages);
  return push({ to: state.userId, messages, retryKey: retryKeyForEvent(state.eventId) });
};

export default replyMessage;
