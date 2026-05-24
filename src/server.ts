import { createApp } from './app';
import { getConfig } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './db';

// Matches Docker's default stop_grace_period — we self-exit before Docker force-kills us.
const SHUTDOWN_DRAIN_MS = 10_000;

const config = getConfig();
const app = createApp();

async function main(): Promise<void> {
  await connectDb();

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'gateway listening');
  });

  function shutdown(signal: NodeJS.Signals): void {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), SHUTDOWN_DRAIN_MS).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error(err, 'startup failed');
  process.exit(1);
});
