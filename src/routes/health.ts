import { Router } from 'express';

export const healthRouter = Router();

// Public health is intentionally minimal: { status } only, never component
// internals (arch §3.1). Degraded reporting is added as Mongo/Redis/provider
// dependencies land in later chunks.
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'healthy' });
});
