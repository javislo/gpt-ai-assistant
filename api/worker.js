import express from 'express';
import {
  handleEvents, getPrompt, setPrompt, removePrompt,
} from '../app/index.js';
import History from '../app/history/history.js';
import HistoryMessage from '../app/history/message.js';
import { getHistory, removeHistory, setHistory } from '../app/history/index.js';
import Prompt from '../app/prompt/prompt.js';
import PromptMessage from '../app/prompt/message.js';
import {
  acquireEvent, completeEvent, releaseEvent, loadResult, loadMemory, withUsageMeter,
} from '../services/agent-state.js';
import { isAsyncEnabled, verifyWorkerSecret, verifyQstashSignature } from '../services/async-queue.js';
import { push } from '../services/line.js';
import storage from '../storage/index.js';
import { retryKeyForEvent, withAsyncDelivery } from '../utils/reply-message.js';

/**
 * Replaces this instance's in-memory prompt and history for the user with the
 * persisted copy (or clears them when nothing is persisted).
 */
const restoreConversation = (userId, saved) => {
  if (!saved) {
    removePrompt(userId);
    removeHistory(userId);
    return;
  }
  const prompt = new Prompt();
  prompt.messages = saved.prompt.map((message) => new PromptMessage(message));
  setPrompt(userId, prompt);
  const history = new History();
  history.messages = saved.history.map((message) => new HistoryMessage(message));
  setHistory(userId, history);
};

const app = express();
app.use(express.json({
  limit: '200kb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer.toString();
  },
}));

// On Vercel the function receives the full request path (/api/worker); '/' is kept for local use.
app.post(['/api/worker', '/'], async (req, res) => {
  if (!isAsyncEnabled()) return res.sendStatus(404);
  let valid = false;
  try {
    valid = verifyWorkerSecret(req.header('x-agent-worker-key'))
      && verifyQstashSignature(req.header('upstash-signature'), req.rawBody);
  } catch {
    return res.sendStatus(503);
  }
  if (!valid) return res.sendStatus(403);

  const { event } = req.body || {};
  const eventId = event?.webhookEventId;
  const userId = event?.source?.userId;
  if (typeof eventId !== 'string' || typeof userId !== 'string'
    || event.source?.type !== 'user' || event.type !== 'message') {
    return res.sendStatus(400);
  }
  let lease;
  try {
    lease = await acquireEvent(eventId, userId);
    if (lease.status === 'done') return res.sendStatus(200);
    if (lease.status !== 'acquired') return res.sendStatus(503);

    // A previous worker may have persisted the response but crashed before push.
    // Never regenerate text or call Gemini for a result already persisted.
    const result = await loadResult(eventId);
    if (result) {
      await push({ to: userId, messages: result, retryKey: retryKeyForEvent(eventId) });
    } else {
      // Load shared state from Redis on every invocation; this instance may be new,
      // or warm with state that another instance has since changed.
      await storage.initialize();
      restoreConversation(userId, await loadMemory(userId));
      await withUsageMeter(() => withAsyncDelivery(
        {
          eventId, userId, getPrompt: () => getPrompt(userId), getHistory: () => getHistory(userId),
        },
        () => handleEvents([event]),
      ));
      // Successful handling with no result (unsupported message) is intentional.
      // The intake handler filters out unsupported kinds before enqueueing.
    }
    await completeEvent(lease);
    return res.sendStatus(200);
  } catch (error) {
    console.error('LINE async worker failed:', error.message);
    if (lease?.status === 'acquired') {
      try { await releaseEvent(lease); } catch (releaseError) {
        console.error('LINE event lease release failed:', releaseError.message);
      }
    }
    return res.sendStatus(503);
  }
});

export default app;
