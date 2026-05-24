import express, { Router, type Express, type Request } from 'express';
import helmet from 'helmet';
import type Redis from 'ioredis';
import { pinoHttp } from 'pino-http';
import { getConfig } from './config';
import { logger } from './logger';
import { correlationId } from './middleware/correlationId';
import { createAuth } from './middleware/auth';
import { createAuthFailureLimiter } from './middleware/authFailureLimiter';
import { createRateLimiter } from './middleware/rateLimiter';
import { createHealthRouter } from './routes/health';
import { livezRouter } from './routes/livez';
import { auditRouter } from './routes/audit';
import { chatRouter } from './routes/chat';
import { errorHandler } from './middleware/errorHandler';

export function createApp(redis?: Redis): Express {
  const app = express();
  // Trust N reverse-proxy hops in front (arch §7.5). 0 = trust none. In docker-compose
  // we set TRUST_PROXY=1 so X-Forwarded-* from nginx is honored, but no further.
  app.set('trust proxy', getConfig().TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());

  app.use(correlationId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as Request).correlationId,
    }),
  );
  app.use(express.json({ limit: getConfig().BODY_SIZE_LIMIT }));

  app.use(livezRouter);
  app.use(createHealthRouter(redis));

  const v1 = Router();
  // Auth-failure IP limiter runs BEFORE auth so banned IPs are 429'd before any DB lookup.
  if (redis) v1.use(createAuthFailureLimiter(redis));
  v1.use(createAuth(redis));
  if (redis) v1.use(createRateLimiter(redis));
  v1.use(auditRouter);
  v1.use(chatRouter);
  app.use('/v1', v1);

  // Last middleware: catch any unhandled throw from a route handler. Logs with
  // correlation ID, returns generic JSON without leaking stack or user input.
  app.use(errorHandler);

  return app;
}
