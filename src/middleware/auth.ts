import type { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import type Redis from 'ioredis';
import { ApiKey } from '../models/apiKey';
import { KEY_PREFIX_BASE } from '../constants';
import { recordAuthFailure } from './authFailureLimiter';

function fail(res: Response, req: Request, redis: Redis | undefined): void {
  // Record IP failure for the auth-failure limiter (arch §7.5).
  void recordAuthFailure(redis, req.ip ?? '');
  res.status(401).json({ error: 'unauthorized', correlationId: req.correlationId });
}

// Factory keeps the same signature semantics as before but accepts an optional Redis
// so the auth middleware can fire-and-forget increment the auth-failure counter.
// Existing tests that import { auth } continue to work — they just don't increment.
export function createAuth(redis?: Redis) {
  return async function auth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawKey = req.headers['x-api-key'];

    // Cheap pre-auth checks — no DB lookup
    if (typeof rawKey !== 'string') {
      fail(res, req, redis);
      return;
    }

    const dot = rawKey.indexOf('.');
    if (dot === -1) {
      fail(res, req, redis);
      return;
    }

    const keyIdPrefix = rawKey.slice(0, dot);
    const secret = rawKey.slice(dot + 1);

    if (!keyIdPrefix.startsWith(KEY_PREFIX_BASE)) {
      fail(res, req, redis);
      return;
    }

    // For body-bearing methods, reject wrong content-type before DB lookup
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (!req.headers['content-type']?.startsWith('application/json')) {
        res.status(415).json({ error: 'unsupported_media_type', correlationId: req.correlationId });
        return;
      }
    }

    // DB lookup — identical 401 for all remaining failures (no oracle)
    try {
      const key = await ApiKey.findOne({ keyIdPrefix }).lean();

      if (!key || !key.active) {
        fail(res, req, redis);
        return;
      }

      if (!(await argon2.verify(key.keyHash, secret))) {
        fail(res, req, redis);
        return;
      }

    req.auth = {
      apiKeyId: key._id,
      role: key.role,
      scopes: key.scopes,
      allowedModels: key.allowedModels,
      rateLimitOverride: key.rateLimitOverride,
    };

    // Best-effort lastUsedAt — non-blocking, never fails the request
    setImmediate(() => {
      ApiKey.findByIdAndUpdate(key._id, { lastUsedAt: new Date() })
        .exec()
        .catch(() => undefined);
    });

      next();
    } catch {
      // DB error — same 401 to avoid leaking information
      fail(res, req, redis);
    }
  };
}
