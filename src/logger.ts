import pino from 'pino';
import { getConfig } from './config';

// Structured JSON logs to stdout. Sensitive headers are redacted so request
// logging can never leak credentials.
export const logger = pino({
  level: getConfig().LOG_LEVEL,
  redact: {
    paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
    remove: true,
  },
});
