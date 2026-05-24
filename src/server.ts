import { createApp } from './app';
import { getConfig } from './config';
import { logger } from './logger';

const config = getConfig();
const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'gateway listening');
});

// Graceful shutdown: stop accepting connections, drain in-flight, then exit.
// Mongo/Redis connection teardown is added as those chunks land.
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
