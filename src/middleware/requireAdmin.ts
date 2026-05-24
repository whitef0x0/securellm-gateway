import type { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', correlationId: req.correlationId });
    return;
  }
  next();
}
