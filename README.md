# SecureLLM Gateway

Security middleware that proxies all LLM calls through a 7-layer detection and redaction pipeline.

## Quick start

```bash
# 1. Generate required secrets and write them into .env
cp .env.example .env
node -e "
const { randomBytes } = require('crypto');
console.log('LOG_PSEUDONYM_SECRET=' + randomBytes(40).toString('hex'));
console.log('PII_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'));
" >> .env

# 2. Start the app, MongoDB, and Redis
docker-compose up --build
```

That's it. The stack starts in **degraded mode** — all security controls are active, but `/v1/chat` returns `503` until you add an `ANTHROPIC_API_KEY` (see below).

> **Keep your `.env` secret.** It is gitignored. The values for `LOG_PSEUDONYM_SECRET` and `PII_ENCRYPTION_KEY` must stay stable — rotating them breaks audit log correlation and makes existing PiiVault records permanently unreadable.

## Seeding API keys

Once the stack is running, create the first client and admin keys:

```bash
# Docker stack:
docker compose exec app npm run seed

# Local dev:
npm run seed
```

The script prints each key once — store them securely. Only an argon2id hash is kept in the database.

## Enabling live LLM calls (optional)

Add your Anthropic API key to `.env` and restart:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com). It is never logged — `getConfig()` in `src/config/index.ts` is the only place it is read, and pino redacts `authorization` and `x-api-key` headers at the transport layer.

## Local dev (without Docker)

Requires Node 22+ and running MongoDB and Redis instances.

```bash
npm install
cp .env.example .env   # then generate and fill in secrets as above
npm run dev            # tsx watch, hot-reload
npm test               # vitest
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
```

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |
| `PORT` | No | `3000` | HTTP listen port |
| `LOG_LEVEL` | No | `info` | `fatal` → `trace` → `silent` |
| `BODY_SIZE_LIMIT` | No | `4mb` | Express body parser limit |
| `MONGO_URI` | No | `mongodb://localhost:27017/securellm` | MongoDB connection |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection |
| `LOG_PSEUDONYM_SECRET` | **Yes** | — | HMAC key for audit log pseudonymization; generate with `randomBytes(40).toString('hex')` |
| `PII_ENCRYPTION_KEY` | **Yes** | — | AES-256-GCM key for PiiVault; generate with `randomBytes(32).toString('base64')` |
| `AUDIT_LOG_TTL_DAYS` | No | `90` | AuditLog document TTL in days |
| `PII_VAULT_TTL_DAYS` | No | `30` | PiiVault document TTL in days |
| `ANTHROPIC_API_KEY` | No | — | If absent, `/v1/chat` returns `503` (degraded mode) |

## Architecture

See [`arch_reviewed.md`](arch_reviewed.md) for the full design, threat model, and implementation decisions.
