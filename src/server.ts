import { createApp } from './app';
import { getConfig } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './db';
import { connectRedis, disconnectRedis } from './redis';
import { SHUTDOWN_DRAIN_MS } from './constants';

const config = getConfig();

async function main(): Promise<void> {
  const [redis] = await Promise.all([
    connectRedis(config.REDIS_URL),
    connectDb(),
  ]);

  const app = createApp(redis);

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'gateway listening');
  });

  function shutdown(signal: NodeJS.Signals): void {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await Promise.all([disconnectDb(), disconnectRedis(redis)]);
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
