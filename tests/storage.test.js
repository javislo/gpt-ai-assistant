// eslint-disable-next-line import/order
import { restoreEnv } from './setup/vercel-storage-env.js';
import {
  afterAll, afterEach, expect, jest, test,
} from '@jest/globals';
import axios from 'axios';
import storage, { BACKEND_VERCEL } from '../storage/index.js';

jest.mock('axios', () => jest.requireActual('./mocks/axios.js').default());

const vercel = () => axios.clients['https://api.vercel.com'];

afterEach(() => {
  jest.clearAllMocks();
  storage.env = undefined;
  storage.data = {};
});

afterAll(() => {
  restoreEnv();
});

test('setItem before initialize loads the stored env first instead of crashing', async () => {
  vercel().get.mockResolvedValue({
    data: { envs: [{ id: 'env-1', key: 'APP_STORAGE', value: JSON.stringify({ sources: { A: { name: 'a' } }, other: { x: 1 } }) }] },
  });
  vercel().patch.mockResolvedValue({ data: {} });

  await expect(storage.setItem('sources', { B: { name: 'b' } })).resolves.toBeUndefined();

  expect(storage.backend).toEqual(BACKEND_VERCEL);
  expect(vercel().patch).toHaveBeenCalledTimes(1);
  const [url, body] = vercel().patch.mock.calls[0];
  expect(url).toEqual('/v9/projects/test-project/env/env-1');
  expect(JSON.parse(body.value)).toEqual({ sources: { B: { name: 'b' } }, other: { x: 1 } });
});

test('setItem after initialize reuses the loaded env', async () => {
  vercel().get.mockResolvedValue({
    data: { envs: [{ id: 'env-2', key: 'APP_STORAGE', value: '{}' }] },
  });
  vercel().patch.mockResolvedValue({ data: {} });
  await storage.initialize();
  await storage.setItem('sources', { C: {} });
  expect(vercel().get).toHaveBeenCalledTimes(1);
  expect(vercel().patch.mock.calls[0][0]).toEqual('/v9/projects/test-project/env/env-2');
  expect(storage.isPersistent).toBe(true);
});
