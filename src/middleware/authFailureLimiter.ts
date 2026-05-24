import type { RequestHandler } from 'express';
import type Redis from 'ioredis';

// Auth-failure IP rate limiter (arch §7.5).
//
// Distinct from the per-API-key sliding-window limiter: this guards against
// brute-force enumeration of API key prefixes *before* a key is identified.
// An attacker hammering random `x-api-key: ak_live_*.<secret>` values would
// otherwise be limited only by HTTP throughput.
//
// Design:
//   - Key the limiter on the trusted client IP (resolved after Express
//     'trust proxy' policy; behind nginx → real client IP from X-Forwarded-For).
//   - Ephemeral state in Redis with a short TTL — we never persist IPs.
//   - Increments only when auth FAILS (set by the auth middleware on 401).
//   - When the IP exceeds the threshold, subsequent requests from that IP get
//     429 with Retry-After before even being parsed by auth.
//
// Two pieces:
//   - `createAuthFailureLimiter(redis)` returns the middleware that CHECKS the
//     counter before auth runs and 429s if over threshold.
//   - `recordAuthFailure(redis, ip)` is called from auth.ts when a request
//     returns 401, to increment that IP's counter.

const PREFIX = 'authfail:';
const WINDOW_S = 60;             // 1-minute sliding count
const THRESHOLD = 10;            // failures per IP per window
const BAN_TTL_S = 5 * 60;        // 5-minute ban after threshold exceeded

export async function recordAuthFailure(redis: Redis | undefined, ip: string): Promise<void> {
  if (!redis || !ip) return;
  const key = `${PREFIX}${ip}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // First failure in this window — set the counter TTL
      await redis.expire(key, WINDOW_S);
    }
    if (count > THRESHOLD) {
      // Extend the TTL into ban territory once threshold is crossed
      await redis.expire(key, BAN_TTL_S);
    }
  } catch {
    // Redis unreachable → degrade silently (per-key rate limiter and provider
    // fail-closed paths handle the broader unavailability cases).
  }
}

export function createAuthFailureLimiter(redis: Redis): RequestHandler {
  return async (req, res, next) => {
    const ip = req.ip ?? '';
    if (!ip) {
      next();
      return;
    }
    const key = `${PREFIX}${ip}`;
    try {
      const countStr = await redis.get(key);
      const count = countStr === null ? 0 : Number(countStr);
      if (count > THRESHOLD) {
        res.setHeader('Retry-After', BAN_TTL_S);
        res.status(429).json({ error: 'too_many_auth_failures', correlationId: req.correlationId });
        return;
      }
      next();
    } catch {
      // Redis failure here is non-fatal — continue and let downstream layers handle
      // their own availability. Failing closed everywhere would amplify Redis outages.
      next();
    }
  };
}
