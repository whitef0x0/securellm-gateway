import { defineConfig } from 'vitest/config';
import { randomBytes } from 'node:crypto';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    env: {
      LOG_LEVEL: 'silent',
      // Generated fresh each test run — no hardcoded secrets in source.
      LOG_PSEUDONYM_SECRET: randomBytes(40).toString('hex'),
      PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      // Pin arm64 MongoDB binary for mongodb-memory-server on Apple Silicon.
      MONGOMS_VERSION: '7.0.0',
      MONGOMS_ARCH: 'arm64',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
});
