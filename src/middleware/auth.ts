import type { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import { ApiKey } from '../models/apiKey';
import { KEY_PREFIX_BASE } from '../constants';

function unauthorized(res: Response, correlationId: string): void {
  res.status(401).json({ error: 'unauthorized', correlationId });
}

export async function auth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = req.headers['x-api-key'];

  // Cheap pre-auth checks — no DB lookup
  if (typeof rawKey !== 'string') {
    unauthorized(res, req.correlationId);
    return;
  }

  const dot = rawKey.indexOf('.');
  if (dot === -1) {
    unauthorized(res, req.correlationId);
    return;
  }

  const keyIdPrefix = rawKey.slice(0, dot);
  const secret = rawKey.slice(dot + 1);

  if (!keyIdPrefix.startsWith(KEY_PREFIX_BASE)) {
    unauthorized(res, req.correlationId);
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
      unauthorized(res, req.correlationId);
      return;
    }

    if (!(await argon2.verify(key.keyHash, secret))) {
      unauthorized(res, req.correlationId);
      return;
    }

    req.auth = {
      apiKeyId: key._id,
      role: key.role,
      scopes: key.scopes,
      allowedModels: key.allowedModels,
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
    unauthorized(res, req.correlationId);
  }
}
