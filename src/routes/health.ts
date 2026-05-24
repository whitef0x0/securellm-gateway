import { Router } from 'express';
import mongoose from 'mongoose';
import type Redis from 'ioredis';
import { getConfig } from '../config';
import { logger } from '../logger';

// Public /healthz reports overall readiness only ({status} field). Component-level
// details (which dep is down) are NOT exposed publicly — they go to internal logs.
// arch §3.1: never leak component internals via the public health route.
//
// Status semantics:
//   - 'healthy'   (200) — Mongo + Redis reachable and ANTHROPIC_API_KEY configured
//   - 'degraded'  (200) — Mongo + Redis reachable but provider not configured
//                           (/v1/chat returns 503; everything else still works)
//   - 'unhealthy' (503) — Mongo or Redis unreachable
export function createHealthRouter(redis?: Redis): Router {
  const router = Router();

  // Accept both GET (default) and HEAD (cheaper probe — Kubernetes liveness/readiness,
  // some load balancers). HEAD returns the same status code with no body, automatic
  // in Express when the GET handler doesn't stream.
  router.head('/healthz', async (_req, res) => {
    res.status(200).end();
  });

  router.get('/healthz', async (_req, res) => {
    const mongoOk = mongoose.connection.readyState === 1;
    let redisOk = false;
    if (redis) {
      try {
        redisOk = (await redis.ping()) === 'PONG';
      } catch {
        redisOk = false;
      }
    }
    const providerConfigured = Boolean(getConfig().ANTHROPIC_API_KEY);

    if (!mongoOk || !redisOk) {
      logger.warn({ mongoOk, redisOk }, 'healthz unhealthy');
      res.status(503).json({ status: 'unhealthy' });
      return;
    }
    if (!providerConfigured) {
      res.json({ status: 'degraded' });
      return;
    }
    res.json({ status: 'healthy' });
  });

  return router;
}
