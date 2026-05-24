import mongoose from 'mongoose';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { getConfig } from '../config';
import { ApiKey } from '../models/apiKey';
import { KEY_PREFIX_CLIENT, KEY_PREFIX_ADMIN } from '../constants';

function generateKey(prefix: string): { keyIdPrefix: string; secret: string; full: string } {
  const keyIdPrefix = prefix + randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('hex');
  return { keyIdPrefix, secret, full: `${keyIdPrefix}.${secret}` };
}

async function seed(): Promise<void> {
  await mongoose.connect(getConfig().MONGO_URI);

  const clientKey = generateKey(KEY_PREFIX_CLIENT);
  const adminKey = generateKey(KEY_PREFIX_ADMIN);

  const [clientHash, adminHash] = await Promise.all([
    argon2.hash(clientKey.secret, { type: argon2.argon2id }),
    argon2.hash(adminKey.secret, { type: argon2.argon2id }),
  ]);

  await ApiKey.create([
    { keyIdPrefix: clientKey.keyIdPrefix, keyHash: clientHash, role: 'client', scopes: [] },
    { keyIdPrefix: adminKey.keyIdPrefix, keyHash: adminHash, role: 'admin', scopes: ['pii:reveal'] },
  ]);

  console.log('Keys created. Store these securely — shown once only.\n');
  console.log(`CLIENT_KEY=${clientKey.full}`);
  console.log(`ADMIN_KEY=${adminKey.full}`);

  await mongoose.disconnect();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
