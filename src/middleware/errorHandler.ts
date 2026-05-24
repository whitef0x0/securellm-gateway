import type { ErrorRequestHandler } from 'express';
import { logger } from '../logger';

// Global error handler — arch §6.4:
//   - log with correlation ID
//   - return consistent JSON
//   - never leak stack traces
//   - never log raw API keys, PII, or injection strings
//
// Routes already handle their own expected errors (auth → 401, scanner → 400, etc.).
// This handler is the last-resort safety net for *unexpected* throws — anything that
// escapes a route handler. It returns a generic 500 without disclosing what went wrong.

interface ExpressErr {
  status?: number;
  statusCode?: number;
  type?: string;
}

// Body-parser errors (oversized payload, malformed JSON) get specific status codes,
// without echoing any of the offending payload.
function classify(err: ExpressErr): { status: number; error: string } {
  if (err.type === 'entity.too.large') return { status: 413, error: 'payload_too_large' };
  if (err.type === 'entity.parse.failed') return { status: 400, error: 'invalid_json' };
  if (err.statusCode === 400 || err.status === 400) return { status: 400, error: 'bad_request' };
  return { status: 500, error: 'internal_error' };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies the 4-arity signature as an error handler; the `next` parameter is required even when unused.
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const correlationId = req.correlationId;
  const e = err as ExpressErr;
  const { status, error } = classify(e);

  // Log the error type and correlation ID only. Do NOT log the request body,
  // headers (may contain x-api-key), or stack contents that might echo user input.
  logger.error(
    { correlationId, status, errType: typeof err, name: (err as Error | undefined)?.name },
    'unhandled error',
  );

  if (res.headersSent) return;
  res.status(status).json({ error, correlationId });
};
