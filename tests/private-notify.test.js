import {
  afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';
import {
  authorizedNotification, notificationConfigured, notificationsEnabled,
  sendPrivateNotification, validateNotification,
} from '../services/private-notify.js';

const old = {};
const keys = ['AGENT_NOTIFICATIONS_ENABLED', 'AGENT_NOTIFY_SECRET', 'LINE_PUSH_USER_ID', 'LINE_CHANNEL_ACCESS_TOKEN'];
const SECRET = 'private-test-token-that-is-longer-than-32-chars';
const USER = `U${'a'.repeat(32)}`;

beforeEach(() => {
  keys.forEach((key) => { old[key] = process.env[key]; });
  Object.assign(process.env, {
    AGENT_NOTIFICATIONS_ENABLED: 'true',
    AGENT_NOTIFY_SECRET: SECRET,
    LINE_PUSH_USER_ID: USER,
    LINE_CHANNEL_ACCESS_TOKEN: 'dummy-line-token',
  });
});

afterEach(() => {
  keys.forEach((key) => {
    if (old[key] === undefined) delete process.env[key];
    else process.env[key] = old[key];
  });
});

test('notifications disabled unless explicitly opted in', () => {
  expect(notificationsEnabled()).toBe(true);
  process.env.AGENT_NOTIFICATIONS_ENABLED = 'false';
  expect(notificationsEnabled()).toBe(false);
});

test('config requires valid fixed user, LINE access token and strong secret', () => {
  expect(notificationConfigured()).toBe(true);
  process.env.LINE_PUSH_USER_ID = 'fake-group-id';
  expect(notificationConfigured()).toBe(false);
  process.env.LINE_PUSH_USER_ID = USER;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  expect(notificationConfigured()).toBe(false);
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'dummy';
  process.env.AGENT_NOTIFY_SECRET = 'short';
  expect(notificationConfigured()).toBe(false);
});

test('only the configured bearer secret is accepted', () => {
  expect(authorizedNotification(`Bearer ${SECRET}`)).toBe(true);
  expect(authorizedNotification(`Bearer ${SECRET}invalid`)).toBe(false);
  expect(authorizedNotification(SECRET)).toBe(false);
  expect(authorizedNotification(undefined)).toBe(false);
  process.env.AGENT_NOTIFY_SECRET = 'short';
  expect(authorizedNotification('Bearer short')).toBe(false);
});

test('message payload rejects dynamic recipients, invalid ids and long messages', () => {
  expect(validateNotification({ id: 'morning-2026-11-24', text: '早安' })).toEqual({
    id: 'morning-2026-11-24', text: '早安',
  });
  expect(() => validateNotification({ id: 'x', text: 'ok', to: USER })).toThrow('Unsupported notification property');
  expect(() => validateNotification({ id: 'bad id', text: 'ok' })).toThrow('Invalid notification id');
  expect(() => validateNotification({ id: 'x', text: ' '.repeat(5) })).toThrow('Invalid notification text');
  expect(() => validateNotification({ id: 'x', text: 'a'.repeat(1801) })).toThrow('Invalid notification text');
});

test('sends only to the fixed user with a stable idempotent retry key', async () => {
  const send = jest.fn(async () => ({ status: 200 }));
  await sendPrivateNotification({ id: 'morning-2026-11-24', text: '早安' }, send);
  await sendPrivateNotification({ id: 'morning-2026-11-24', text: '早安' }, send);
  expect(send).toHaveBeenCalledTimes(2);
  const first = send.mock.calls[0][0];
  const second = send.mock.calls[1][0];
  expect(first.to).toEqual(USER);
  expect(first.messages).toEqual([{ type: 'text', text: '早安' }]);
  expect(first.retryKey).toEqual(second.retryKey);
  expect(first.retryKey).toMatch(/^[0-9a-f-]{36}$/);
});

test('never sends when configuration is incomplete', async () => {
  delete process.env.LINE_PUSH_USER_ID;
  const send = jest.fn();
  await expect(sendPrivateNotification({ id: 'x', text: 'hi' }, send)).rejects.toThrow('configuration is missing');
  expect(send).not.toHaveBeenCalled();
});
