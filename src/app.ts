import express, { Router, type Express, type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getConfig } from './config';
import { logger } from './logger';
import { correlationId } from './middleware/correlationId';
import { auth } from './middleware/auth';
import { healthRouter } from './routes/health';
import { livezRouter } from './routes/livez';
import { auditRouter } from './routes/audit';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', false);
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
  app.use(healthRouter);

  const v1 = Router();
  v1.use(auth);
  v1.use(auditRouter);
  app.use('/v1', v1);

  return app;
}
