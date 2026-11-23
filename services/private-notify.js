import { createHash, timingSafeEqual } from 'node:crypto';
import { push } from './line.js';
import { retryKeyForEvent } from '../utils/reply-message.js';

const USER_ID_PATTERN = /^U[0-9a-fA-F]{32}$/;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

export const notificationsEnabled = () => process.env.AGENT_NOTIFICATIONS_ENABLED === 'true';

export const notificationConfigured = () => (
  typeof process.env.AGENT_NOTIFY_SECRET === 'string'
  && process.env.AGENT_NOTIFY_SECRET.length >= 32
  && USER_ID_PATTERN.test(process.env.LINE_PUSH_USER_ID || '')
  && Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
);

// A hash of each token is compared in constant time. Never log either token.
export const authorizedNotification = (authorization) => {
  const secret = process.env.AGENT_NOTIFY_SECRET;
  if (typeof secret !== 'string' || secret.length < 32
    || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const actual = createHash('sha256').update(secret).digest();
  const provided = createHash('sha256').update(authorization.slice(7)).digest();
  return timingSafeEqual(actual, provided);
};

const badRequest = (reason) => Object.assign(new Error(reason), { status: 400 });

export const validateNotification = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Expected a JSON object');
  }
  // The recipient can never be supplied by a scheduler or webhook caller.
  if (Object.keys(body).some((field) => !['id', 'text'].includes(field))) {
    throw badRequest('Unsupported notification property');
  }
  if (typeof body.id !== 'string' || !DELIVERY_ID_PATTERN.test(body.id)) {
    throw badRequest('Invalid notification id');
  }
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1800) {
    throw badRequest('Invalid notification text');
  }
  return { id: body.id, text: body.text.trim() };
};

export const sendPrivateNotification = async (body, send = push) => {
  if (!notificationConfigured()) {
    throw Object.assign(new Error('Private notification configuration is missing'), { status: 503 });
  }
  const { id, text } = validateNotification(body);
  await send({
    to: process.env.LINE_PUSH_USER_ID,
    messages: [{ type: 'text', text }],
    // LINE accepts a stable retry key to avoid double delivery on transport retries.
    retryKey: retryKeyForEvent(`private-notification:${id}`),
  });
  return { ok: true };
};
