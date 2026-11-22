import express from 'express';
import { handleEvents, getPrompt, setPrompt } from '../app/index.js';
import Prompt from '../app/prompt/prompt.js';
import { acquireEvent, completeEvent, releaseEvent, loadResult, loadMemory, withUsageMeter } from '../services/agent-state.js';
import { isAsyncEnabled, verifyWorkerSecret, verifyQstashSignature } from '../services/async-queue.js';
import { push } from '../services/line.js';
import { retryKeyForEvent, withAsyncDelivery } from '../utils/reply-message.js';

const app = express();
app.use(express.json({ limit: '200kb', verify: (req, res, buffer) => {
  req.rawBody = buffer.toString();
} }));

app.post('/', async (req, res) => {
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
      const saved = await loadMemory(userId);
      if (saved) {
        const prompt = new Prompt();
        prompt.messages = saved;
        setPrompt(userId, prompt);
      }
      await withUsageMeter(() => withAsyncDelivery({ eventId, userId },
        () => handleEvents([event])));
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
