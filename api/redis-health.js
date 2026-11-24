import { createHash, timingSafeEqual } from 'node:crypto';
import { pingRedis } from '../services/agent-state.js';

const digest = (value) => createHash('sha256').update(value).digest();

// Authenticated, read-only connectivity check. Never call weather, LINE or Gemini.
export default async function redisHealth(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(404).json({ ok: false });
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string'
    || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return res.status(401).json({ ok: false });
  }
  try {
    const ok = await pingRedis();
    return res.status(ok ? 200 : 503).json({ ok });
  } catch {
    // Do not return or log URLs, tokens, upstream errors, or stored data.
    return res.status(503).json({ ok: false });
  }
}
