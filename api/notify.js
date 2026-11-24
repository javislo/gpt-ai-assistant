import express from 'express';
import {
  authorizedNotification, notificationConfigured, notificationsEnabled, sendPrivateNotification,
} from '../services/private-notify.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));

// Disabled by default. This endpoint is for a trusted scheduler, never public LINE events.
app.post(['/api/notify', '/'], async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!notificationsEnabled()) return res.sendStatus(404);
  if (!notificationConfigured()) return res.sendStatus(503);
  if (!authorizedNotification(req.get('authorization'))) return res.sendStatus(403);
  try {
    await sendPrivateNotification(req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    // Log a status code only, never a secret, recipient, or message body.
    console.error('Private LINE notification failed', error.response?.status || 'upstream');
    return res.sendStatus(503);
  }
});

export default app;
