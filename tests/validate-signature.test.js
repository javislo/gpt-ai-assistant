import { createHmac } from 'node:crypto';
import { expect, test } from '@jest/globals';
import validateSignature from '../utils/validate-signature.js';

const SECRET = 'test-channel-secret';
const BODY = '{"events":[]}';
const sign = (body) => createHmac('sha256', SECRET).update(body).digest('base64');

test('accepts a correct LINE signature', () => {
  expect(validateSignature(BODY, SECRET, sign(BODY))).toBe(true);
});

test('rejects a wrong signature', () => {
  expect(validateSignature(BODY, SECRET, sign('{"events":[1]}'))).toBe(false);
  expect(validateSignature(BODY, SECRET, 'invalid')).toBe(false);
});

test('rejects a missing signature or body instead of throwing', () => {
  expect(validateSignature(BODY, SECRET, undefined)).toBe(false);
  expect(validateSignature(BODY, SECRET, '')).toBe(false);
  expect(validateSignature(undefined, SECRET, sign(BODY))).toBe(false);
});
