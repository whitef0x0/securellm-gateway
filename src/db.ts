import mongoose from 'mongoose';
import { getConfig } from './config';
import { logger } from './logger';

export async function connectDb(): Promise<void> {
  await mongoose.connect(getConfig().MONGO_URI);
  logger.info('connected to mongodb');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
