# SecureLLM Gateway

Security middleware that proxies all LLM calls through a 7-layer detection and redaction pipeline.

## Quick start (required path)

```bash
# 1. Copy env template and fill in secrets (see below)
cp .env.example .env
# edit .env

# 2. Start app + mongo + redis
docker-compose up --build
```

The stack starts without `ANTHROPIC_API_KEY`. In that case `/v1/chat` returns `503` (degraded mode). All other security controls and endpoints are fully functional.

## Generating secrets

Run this once and paste the output into your `.env`:

```bash
node -e "
const { randomBytes } = require('crypto');
console.log('LOG_PSEUDONYM_SECRET=' + randomBytes(40).toString('hex'));
console.log('PII_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'));
"
```

**Important:** These values must be stable. Changing `LOG_PSEUDONYM_SECRET` breaks audit log correlation. Changing `PII_ENCRYPTION_KEY` makes all existing PiiVault records permanently unreadable.

## Local dev (without Docker)

Requires Node 22+ and running Mongo + Redis instances.

```bash
npm install
cp .env.example .env   # fill in secrets
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
| `LOG_PSEUDONYM_SECRET` | **Yes** | — | 32+ chars; HMAC key for audit log key pseudonymization |
| `PII_ENCRYPTION_KEY` | **Yes** | — | 32 bytes, base64-encoded; AES-256-GCM key for PiiVault |
| `AUDIT_LOG_TTL_DAYS` | No | `90` | AuditLog TTL in days |
| `PII_VAULT_TTL_DAYS` | No | `30` | PiiVault TTL in days |
| `ANTHROPIC_API_KEY` | No | — | If absent, service starts degraded; `/v1/chat` returns 503 |

## Architecture

See [`arch_reviewed.md`](arch_reviewed.md) for the full design, threat model, and implementation decisions.
