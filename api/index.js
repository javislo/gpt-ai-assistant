import express from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { handleEvents, printPrompts } from '../app/index.js';
import config from '../config/index.js';
import { validateLineSignature } from '../middleware/index.js';
import storage from '../storage/index.js';
import { enqueueEvent, isAsyncEnabled } from '../services/async-queue.js';
import { fetchVersion, getVersion } from '../utils/index.js';
import { sendDailyWeather } from '../app/weather/index.js';

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));

app.get('/', async (req, res) => {
  if (config.APP_URL) {
    res.redirect(config.APP_URL);
    return;
  }
  const currentVersion = getVersion();
  const latestVersion = await fetchVersion();
  res.status(200).send({ status: 'OK', currentVersion, latestVersion });
});

app.post(config.APP_WEBHOOK_PATH, validateLineSignature, async (req, res) => {
  try {
    if (isAsyncEnabled()) {
      // Enqueue first; acknowledge LINE only once the durable queue accepts every event.
      // Unsupported and group events are deliberately not processed by the private agent.
      const events = (req.body.events || []).filter((e) => (
        e.type === 'message' && e.source?.type === 'user'
        && ['text', 'audio', 'image', 'location'].includes(e.message?.type)
      ));
      // Enqueue one by one so a batch keeps LINE's order in the FIFO queue.
      await events.reduce((previous, event) => previous.then(() => enqueueEvent(event)), Promise.resolve());
    } else {
      await storage.initialize();
      await handleEvents(req.body.events);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(err.message);
    res.sendStatus(500);
  }
  if (config.APP_DEBUG) printPrompts();
});

const digest = (value) => createHash('sha256').update(String(value)).digest();

// Morning weather push. Vercel Cron (Production) sends
// "Authorization: Bearer $CRON_SECRET"; an external scheduler calling a Preview
// URL must send the same header. Without CRON_SECRET the endpoint is off.
const handleWeatherCron = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.sendStatus(404);
  if (!timingSafeEqual(digest(req.header('authorization') || ''), digest(`Bearer ${secret}`))) {
    return res.sendStatus(401);
  }
  try {
    await storage.initialize();
    return res.status(200).send(await sendDailyWeather());
  } catch (err) {
    console.error('Weather cron failed:', err.message);
    return res.sendStatus(500);
  }
};

app.get('/api/cron/weather', handleWeatherCron);
app.post('/api/cron/weather', handleWeatherCron);

if (config.APP_PORT) {
  app.listen(config.APP_PORT);
}

export default app;
