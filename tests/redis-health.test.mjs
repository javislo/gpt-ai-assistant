import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/redis-health.js';

test('Redis health: auth, PING only, sanitization and bounded failures', async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let calls;
  let response;
  const invoke = async (authorization = 'Bearer local-test-secret', method = 'GET') => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, headers: { authorization } }, res);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    return res;
  };
  try {
    process.env.CRON_SECRET = 'local-test-secret';
    process.env.UPSTASH_REDIS_REST_URL = 'https://synthetic.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-token';
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (response instanceof Error) throw response;
      return response;
    };
    await t.test('reject unauthorized and unsupported methods without Redis access', async () => {
      calls = [];
      for (const authorization of [undefined, '', 'Bearer wrong', ['Bearer local-test-secret']]) {
        const req = { method: 'GET', headers: { authorization } };
        const res = { setHeader() {}, status(s) { this.code = s; return this; }, json() {} };
        await handler(req, res);
        assert.equal(res.code, 401);
      }
      assert.equal((await invoke('Bearer local-test-secret', 'POST')).statusCode, 405);
      assert.equal(calls.length, 0);
    });
    await t.test('disabled without secret, no Redis access', async () => {
      calls = [];
      delete process.env.CRON_SECRET;
      assert.equal((await invoke()).statusCode, 404);
      assert.equal(calls.length, 0);
      process.env.CRON_SECRET = 'local-test-secret';
    });
    await t.test('successful probe sends exactly one PING with abort signal', async () => {
      calls = [];
      response = { ok: true, json: async () => ({ result: 'PONG' }) };
      const res = await invoke();
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true });
      assert.equal(calls.length, 1);
      assert.deepEqual(JSON.parse(calls[0].options.body), ['PING']);
      assert.equal(calls[0].options.method, 'POST');
      assert.ok(calls[0].options.signal instanceof AbortSignal);
    });
    await t.test('HTTP, Redis error, timeout and unexpected results fail closed, no retry', async () => {
      for (const failure of [
        { ok: false, status: 401 },
        { ok: true, json: async () => ({ error: 'synthetic-sensitive-error' }) },
        { ok: true, json: async () => ({ result: 'unexpected' }) },
        new Error('synthetic-token https://synthetic.upstash.io timeout'),
      ]) {
        calls = [];
        response = failure;
        const res = await invoke();
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, { ok: false });
        assert.equal(calls.length, 1);
      }
    });
    await t.test('missing Redis credentials fail without network access', async () => {
      calls = [];
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      assert.equal((await invoke()).statusCode, 503);
      assert.equal(calls.length, 0);
    });
  } finally {
    for (const key of ['CRON_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    globalThis.fetch = originalFetch;
  }
});
