import type { RequestHandler } from 'express';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZADD', key, now, member)
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)

return count
`;

export function createRateLimiter(redis: Redis): RequestHandler {
  return async (req, res, next) => {
    const keyId = req.auth?.apiKeyId.toString();
    if (!keyId) { next(); return; }

    const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } = getConfig();
    const limit = req.auth?.rateLimitOverride ?? RATE_LIMIT_MAX_REQUESTS;
    const now = Date.now();
    const member = `${now}:${randomUUID()}`;
    const redisKey = `ratelimit:${keyId}`;

    try {
      const count = await redis.eval(SCRIPT, 1, redisKey, now, RATE_LIMIT_WINDOW_MS, limit, member) as number;

      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

      if (count > limit) {
        res.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
        res.status(429).json({ error: 'rate_limit_exceeded', correlationId: req.correlationId });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: 'rate_limiter_unavailable', correlationId: req.correlationId });
    }
  };
}
