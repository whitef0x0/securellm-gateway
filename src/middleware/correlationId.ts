import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// Assigns a fresh UUID per request (client-supplied IDs are not trusted) and
// echoes it in the X-Request-Id response header. Threaded through logs and audit.
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.correlationId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
