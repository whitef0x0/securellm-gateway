import express, { type Express, type Request } from 'express';
import { pinoHttp } from 'pino-http';
import { getConfig } from './config';
import { logger } from './logger';
import { correlationId } from './middleware/correlationId';
import { healthRouter } from './routes/health';
import { livezRouter } from './routes/livez';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationId);
  app.use(
    pinoHttp({
      logger,
      // correlationId middleware (above) has already attached req.correlationId.
      genReqId: (req) => (req as unknown as Request).correlationId,
    }),
  );
  app.use(express.json({ limit: getConfig().BODY_SIZE_LIMIT }));

  app.use(livezRouter);
  app.use(healthRouter);

  return app;
}
