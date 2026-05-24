import { Router } from 'express';

export const livezRouter = Router();

// Liveness only: confirms the process is up. No dependency checks by design,
// so a dependency outage cannot trigger pointless restarts (arch §3).
livezRouter.get('/livez', (_req, res) => {
  res.json({ status: 'alive' });
});
