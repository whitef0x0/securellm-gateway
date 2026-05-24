import Redis from 'ioredis';
import { logger } from './logger';

export async function connectRedis(url: string): Promise<Redis> {
  const client = new Redis(url, { lazyConnect: true });
  await client.connect();
  logger.info('connected to redis');
  return client;
}

export async function disconnectRedis(client: Redis): Promise<void> {
  await client.quit();
}
