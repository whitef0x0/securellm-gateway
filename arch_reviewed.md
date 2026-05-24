Understood. I’ll produce a complete replacement arch.md, with the agreed v1 scope made implementation-ready and a clear v2 backlog at the end.

Thought for 15s

Understood. I interpreted F-03 as the guardrailed two-copy normalization approach: preserve the forwarded copy for product quality, but treat material normalization differences as an escalation signal and fail closed if the judge is unavailable.

Below is a full replacement copy of arch.md, updated from the uploaded architecture and brief.

# SecureLLM Gateway — Architecture & Design Decisions

> **Status:** FINALIZED pre-implementation design — ready for implementation with Claude Code.
> No application code has been written yet.
>
> This document is the implementation source of truth. Claude Code should implement exactly this
> architecture, in this order, without adding new features unless they are listed as v1 requirements.
>
> **Primary goal:** pass the challenge acceptance criteria with a small, correct, testable v1.
> Prefer deterministic, auditable security controls over broad claims.
>
> **Do not overbuild.** Anything listed in §17 is v2/future work and should not be implemented in
> the v1 take-home unless explicitly requested later.

---

## 1. Purpose & Threat Model

The SecureLLM Gateway is middleware that sits between application code and external LLM providers.
Every LLM call in the organization routes through it. It enforces uniform security controls and
audits every call so application teams do not re-implement security logic.

It is the boundary between:

- trusted application callers,
- untrusted user-supplied input,
- untrusted LLM output,
- and a regulated data environment.

Design priorities, in order:

1. **Security correctness** — controls must genuinely work, never be pass-through stubs.
2. **Acceptance-criteria coverage** — required corpus attacks must block with `400` and audit.
3. **Auditability** — every allow/block/error decision must be explainable and recorded.
4. **Data minimization & privacy** — no raw PII in logs; PII is redacted before model egress.
5. **Operational robustness** — `docker-compose up` must work on the required path.
6. **Code quality** — TypeScript strict, linted, readable, unit-tested.

### 1.1 Required acceptance behavior

The required corpus is design data used only for defensive testing.

For v1, the gateway must satisfy these hard rules:

- Every required injection corpus item must be blocked at input with:
  - HTTP `400`
  - an audit record
  - `detectedThreats[]` containing the rule and pattern name that fired
- Required PII categories must be redacted before the LLM sees the data:
  - email
  - phone, including Israeli and international formats
  - Israeli national ID
- PII redaction must be reversible only through the audit reveal path.
- Output validation must independently catch:
  - secret-looking strings
  - echoed injection payloads
  - obvious system/context disclosure markers
- L5 structural isolation and L6 output validation are defense-in-depth.
  They are not substitutes for input blocking of required injection corpus items.

### 1.2 Safety handling of corpus examples

The malicious examples in the brief are treated as inert test data. They are never executed,
followed, roleplayed, or pasted wholesale into logs. Tests should use sanitized fixtures or
small representative strings sufficient to prove detector behavior.

---

## 2. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript, `strict: true` | Required by brief |
| HTTP | Express | Simple and sufficient for v1 |
| Security headers | Helmet | Adds X-Content-Type-Options, X-Frame-Options, HSTS, and removes x-powered-by. Single middleware, v1 defaults. |
| Datastore | MongoDB via Mongoose | Required by brief; useful indexes and schema validation |
| Cache / rate limit | Redis via `ioredis` | Required by brief |
| Key hashing | argon2id | Memory-hard API key secret verification |
| LLM provider | Anthropic SDK | Real provider integration; no stubbing in app code |
| Logging | pino + pino-http | Structured JSON logs |
| Validation | zod | Runtime validation for env and request bodies |
| Testing | Vitest | TypeScript-friendly unit/integration tests |
| Lint | ESLint + `@typescript-eslint` | Required quality gate |
| Regex engine | Native JS RegExp in v1, safe-pattern discipline and performance tests | `node-re2` deferred to v2 to keep v1 small |
| Reverse proxy | nginx only in optional prod compose | Required path should stay boring |

### 2.1 Explicit v1 scope decision on regex engine

v1 does **not** depend on `node-re2` to avoid native module build friction in the take-home.

Instead v1 must:

- keep regexes simple and bounded,
- avoid nested quantifiers,
- avoid catastrophic ambiguous alternation,
- cap request size,
- include ReDoS-style performance tests for L2 and L6.

`node-re2` is listed in §17 as a production hardening item.

---

## 3. Required Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/chat` | client/admin | Full security pipeline to real LLM provider |
| GET | `/v1/audit` | admin only | Audit metadata since timestamp; `limit <= 500` |
| GET | `/v1/audit?reveal=<correlationId>` | admin + `pii:reveal` scope | Reveal tokenized PII for one audit record |
| GET | `/healthz` | none | Minimal readiness status |
| GET | `/livez` | none | Process liveness only |

### 3.1 `/healthz` public response

Public `/healthz` must not expose detailed component internals.

Return only:

```json
{ "status": "healthy" }

or:

{ "status": "degraded" }

Detailed Mongo/Redis/provider status should be logged internally. If an internal detailed health
endpoint is later needed, make it admin-only or network-restricted. Do not implement that in v1.

3.2 Provider degraded mode

If the Anthropic provider key is missing:

the service must still start,
/healthz returns degraded,
/v1/chat returns 503,
no provider stub is used.
4. Request Pipeline for POST /v1/chat

The pipeline order is security-sensitive.

POST /v1/chat
  │
  ▼
[0] Cheap pre-auth request checks
    - x-api-key header present
    - syntactically valid key prefix shape
    - content-type application/json
    - nginx/Express body limit enforced
  │
  ▼
[1] Correlation ID
    - UUID assigned
    - X-Request-Id response header
  │
  ▼
[1b] Security headers + proxy trust
    - Helmet (first middleware, all routes)
    - app.set('trust proxy', false) — explicit, no X-Forwarded-For trust without nginx
  │
  ▼
[2] Body parsing
    - express.json() with BODY_SIZE_LIMIT
  │
  ▼
[3] Authentication
    - x-api-key required
    - argon2id verify secret against Mongo hash
    - role attached to request
  │
  ▼
[4] Rate limiting
    - Redis sliding window per API key ID
  │
  ▼
[5] PII redaction
    - redact email, phone, Israeli national ID
    - build request-local token map
  │
  ▼
[6] Injection detection L1–L4
    - normalization
    - regex pre-filter
    - deterministic segmentation + local classifier
    - conditional LLM judge, fail-closed if triggered and unavailable
    - required corpus blocks here with 400 + audit rule
  │
  ▼
[7] Structural isolation L5
    - randomized XML nonce wrapping
    - defense-in-depth only
  │
  ▼
[8] LLM provider call
    - real Anthropic call if provider configured
    - non-streaming
  │
  ▼
[9] Output validation L6
    - secret patterns
    - injection echo / compromise markers
    - system/context disclosure markers
    - outbound PII scan
    - render/exfil guard
  │
  ▼
[10] PII rehydration
    - only request-local tokens are restored
  │
  ▼
[11] Synchronous audit write
    - AuditLog required
    - PiiVault required if PII was redacted
    - successful response is not emitted until audit write succeeds
  │
  ▼
Response
4.1 Critical invariant

No successful /v1/chat response may be emitted until the corresponding audit write succeeds.

If audit persistence fails:

return 500,
do not return the LLM content,
log the failure with correlation ID,
do not include raw PII or prompt text in logs.

This adds one Mongo write to the hot path. That is accepted in v1 because the brief requires
per-request auditability and because the LLM provider call is expected to dominate latency.

Durable outbox is v2.

5. Directory Structure
src/
  middleware/
    correlationId.ts
    preAuthRequestChecks.ts
    auth.ts
    rateLimiter.ts
    piiRedactor.ts
    injectionDetector.ts
    outputValidator.ts
    auditMiddleware.ts
    errorHandler.ts

  detection/
    normalize.ts
    segmentation.ts
    patterns/
      inputInjectionPatterns.ts
      outputLeakPatterns.ts
      secretPatterns.ts
      piiPatterns.ts
    classifier.ts
    llmJudge.ts
    structuralIsolation.ts

  services/
    llmProvider.ts
    auditLogger.ts
    piiVault.ts
    keyService.ts

  models/
    apiKey.ts
    auditLog.ts
    piiVault.ts

  crypto/
    pseudonym.ts
    fieldCrypto.ts

  routes/
    chat.ts
    audit.ts
    health.ts
    livez.ts

  config/
    index.ts

  app.ts
  server.ts

tests/
  auth/
  rateLimiter/
  pii/
  detection/
  outputValidation/
  audit/
  health/
  integration/

Dockerfile
docker-compose.yml
docker-compose.prod.yml
.gitleaks.toml
.env.example
README.md
6. Cross-Cutting Concerns
6.1 Correlation ID

Every request gets a UUID correlation ID.

The correlation ID must appear in:

X-Request-Id response header,
pino logs,
AuditLog,
PiiVault link field.
6.2 Body size and large-context policy

v1 supports reasonably large chat bodies but does not support unlimited full-context uploads.

Policy:

nginx, if present, enforces client_max_body_size.
Express enforces BODY_SIZE_LIMIT, default 4mb.
BODY_SIZE_LIMIT is configurable.
preAuthRequestChecks run before JSON body parsing.
Oversized requests return 413.
v1 does not implement separate document ingestion.
Larger production uploads should use a future document-ingestion path.
6.3 Pre-auth request checks

Before JSON body parsing, perform cheap checks:

x-api-key header exists,
key has the shape <keyIdPrefix>.<secret>,
keyIdPrefix has the expected prefix, for example ak_live_,
content-type is application/json.

These checks must not perform Mongo lookup and must not reveal whether a key exists.

Failure response:

{ "error": "unauthorized", "correlationId": "<id>" }

or for unsupported media type:

{ "error": "unsupported_media_type", "correlationId": "<id>" }
6.4 Error handling

The global error handler must:

log with correlation ID,
return consistent JSON,
never leak stack traces,
never log raw API keys,
never log raw PII,
never log raw injection strings.
7. Security Control 1 — Authentication
7.1 API key format
x-api-key: <keyIdPrefix>.<secret>

Example shape:

ak_live_7f3a2b.<secret>

The prefix is public lookup material. The secret is verified with argon2id.

7.2 Mongo model: ApiKey
Field	Type	Notes
keyIdPrefix	string	Public lookup handle, unique index
keyHash	string	argon2id hash of secret
role	`"client"	"admin"`
scopes	string[]	Example: pii:reveal
allowedModels	string[] optional	Empty/absent means all configured provider models
rateLimitOverride	number optional	Requests per minute
maxBodyBytes	number optional	Optional larger body limit per key, v1 may omit implementation
active	boolean	Soft delete
createdAt	Date	
lastUsedAt	Date	
7.3 Auth behavior
Missing/malformed/unknown/inactive/wrong-secret keys all return identical 401.
Do not reveal whether the key prefix exists.
Use argon2.verify() for secret verification.
Attach { apiKeyId, role, scopes, allowedModels } to request context.
Update lastUsedAt best-effort after successful auth.
7.4 Admin gate

GET /v1/audit requires:

authenticated key,
role admin.

GET /v1/audit?reveal=<correlationId> additionally requires:

scope pii:reveal.

Authenticated non-admins receive 403.

7.5 Auth-failure IP limiter and proxy trust

The app is expected to receive production traffic only from nginx when nginx is used.

Policy:

Express must trust only the nginx container/subnet as proxy.
X-Forwarded-For must be ignored unless the immediate peer is trusted nginx.
Auth-failure rate limiter keys on the trusted client IP resolved after this proxy policy.
Do not trust arbitrary X-Forwarded-For from the public internet.

If nginx is not present in local compose, Express should use the direct peer IP.

8. Security Control 2 — Rate Limiting

Use Redis sorted-set sliding window per API key ID.

Default:

30 requests / minute

Per-key override:

apiKey.rateLimitOverride

Atomic Lua script:

ZADD ratelimit:{keyId} <now_ms> <unique_member>
ZREMRANGEBYSCORE ratelimit:{keyId} 0 <now_ms - window_ms>
ZCARD ratelimit:{keyId}
EXPIRE ratelimit:{keyId} <window_s + 1>
if count > limit then reject

Important implementation detail:

The sorted-set member must be unique per request.
Do not use only now_ms as the member because concurrent requests in the same millisecond can collide.
Use ${nowMs}:${randomUUID} or equivalent.

Behavior:

Limit exceeded: 429 with Retry-After.
Redis unavailable: 503.
Fail closed; do not silently disable rate limiting.

Headers:

X-RateLimit-Limit
X-RateLimit-Remaining

Implementation pattern:

createRateLimiter(redis: Redis, opts) returns a RequestHandler — dependency injection,
no global singleton. The Redis client is created in server.ts (connectRedis(url) returns
the client) and passed into createApp(redis?). Tests that exercise rate limiting pass a
real Redis client; tests for other concerns (auth, health) call createApp() with no Redis
and the rate limiter is simply not wired. This avoids global state and makes the dependency
explicit.

connectRedis(url) / disconnectRedis(client) in src/redis.ts own the lifecycle.
server.ts calls disconnectRedis(redis) in the graceful shutdown callback.
Retry-After on 429
9. Security Control 3 — Injection Detection

Injection detection is the core of v1.

Required corpus attacks must block at input with:

HTTP 400,
audit status: blocked,
detectedThreats[] containing rule, patternName, and location.
9.1 Layer overview
Layer	Mechanism	Required in v1	Purpose
L1	Normalization	Yes	Defeat common encoding/homoglyph/control-char evasion
L2	Regex/heuristic pre-filter	Yes	Deterministic named rules for corpus and auditability
L3	Local ML classifier	Yes	protectai/deberta-v3-base-prompt-injection-v2 (~139 M params) via @huggingface/transformers — ungated on HuggingFace (works out of the box in unattended Docker builds without HF token), fine-tuned for prompt injection, plug-and-play (no native module compilation). Score band feeds L4 escalation. Multilingual upgrade to Llama Prompt Guard 2 documented in §17.11 v2.
L4	LLM judge	Yes, conditional	Semantic backstop; fires on L1/L2/heuristic escalation signals (non-Latin, encoding anomalies, partial matches); fail-closed
L5	Structural isolation	Yes	Reduce impact if something slips through
L6	Output validation	Yes	Backstop on untrusted model output
9.2 L1 normalization

L1 produces two copies:

Detection copy
NFKC normalization
strip null/control characters except normal whitespace
whitespace collapse
base64/hex decode-and-inspect
targeted confusables fold
used by L2/L3/L4
Forwarded copy
NFKC normalization
strip null/control characters except normal whitespace
does not confusables-fold by default
used for L5 wrapping and provider call
9.3 Normalization differential policy

The gateway may preserve a less-mutated forwarded copy for product quality, but differences
between the detection copy and forwarded copy must not be ignored.

If L1 detects any material normalization change, add escalation signal:

NORMALIZATION_DIFFERENTIAL

Material changes include:

confusables folding changed any character,
base64/hex blob was detected,
decoded content contains injection-like text,
control stripping removed non-whitespace controls,
suspicious delimiter tokens appeared only after normalization or decoding.

Required behavior:

If NORMALIZATION_DIFFERENTIAL is present:
  - run L2 and L3 as usual on the detection copy
  - if L2/L3 block, return 400
  - otherwise escalate to L4
  - if L4 is unavailable or times out, fail closed

This preserves legitimate multilingual text where possible, while preventing silent parser
differentials between what the gateway inspects and what the provider receives.

9.4 Decode-and-inspect policy

v1 supports common encodings only:

base64-looking blobs,
hex-looking blobs.

Rules:

decode only when candidate length and character set look plausible,
inspect decoded content with L2,
do not replace forwarded user text with decoded text,
add ENCODED_PAYLOAD_DETECTED escalation signal if a decodable blob exists,
cap decoding work per request.

Nested/exotic recursive decoding is v2.

9.5 L2 regex/heuristic pre-filter

L2 ships named deterministic pattern families.

Patterns must be:

case-insensitive where appropriate,
whitespace-tolerant,
bounded,
simple enough to avoid catastrophic backtracking,
covered by performance tests.

v1 uses native JS RegExp with safe-pattern discipline. node-re2 is v2.

Required categories:

Rule	Purpose
ROLE_OVERRIDE	Ignore-rules, role reassignment, unrestricted/debug/persona hijack
SYSTEM_PROMPT_EXTRACTION	Requests to reveal system/developer/initial instructions or prior context
CREDENTIAL_PROBE	Requests for env vars, config, API keys, secrets
DELIMITER_INJECTION	Forged system/admin/end-user markers, HTML comment smuggling
INDIRECT_INJECTION	Translate-and-execute, hidden content instructions, smuggled payload execution
STRUCTURED_BYPASS	Forced JSON/structured output indicating filters disabled or bypass accepted

Important: L2 patterns should use sanitized representative strings in tests. Do not paste the
entire attack corpus into source comments or logs.

9.6 L3 local classifier — DeBERTa-v3-base prompt-injection (v1)

L3 v1 uses `protectai/deberta-v3-base-prompt-injection-v2` (~139 M params) accessed via
@huggingface/transformers.

Why this model in v1 (and what changes in v2):

- **Ungated on HuggingFace** — downloads on first run without an HF auth token, which means
  `docker-compose up` works for evaluators without any extra setup. Meta's Llama Prompt Guard 2
  (LPG2) is gated and requires accepting a license + setting `HF_TOKEN`, which would break the
  required-path quick-start. v2 (§17.11) swaps to LPG2 once an org-level HF token is available.
- Trained specifically for prompt injection + jailbreaks (vs general text classification).
- English-focused in v1 — non-English attacks like INJ-E3 (Hebrew translate-and-execute)
  are caught by the English instruction inside the quote (`ignore the previous instructions`)
  via L2 regex, with L4 Haiku as semantic backstop. LPG2's multilingual coverage in v2 makes
  this a non-issue.

Why @huggingface/transformers (not onnxruntime-node direct):

- Pure JS/WASM — no native module compilation required, no platform-specific build failures
  in CI (avoids the onnxruntime-node arm64-vs-x86_64 trap).
- Tokenizer is bundled — no separate tokenizer integration.
- Integration code: ~30 lines vs ~200 lines for onnxruntime-node direct.
- HuggingFace-maintained, same org as the model weights.

Runtime: int8 quantization, ~85 MB on disk, ~200 MB resident.
Startup: model loads once at process start; readiness check must fail if load fails.

Score band:
- score ≥ 0.85 → L3 blocks (high-confidence injection), HTTP 400 + audit JUDGE_INJECTION
  with rule `L3_CLASSIFIER_HIGH_CONFIDENCE`
- 0.5 ≤ score < 0.85 → escalate to L4 with signal `L3_MID_CONFIDENCE`
- score < 0.5 → continue to existing escalation logic

L3 runs after L2 (regex pre-filter). If L2 blocked, L3 does not run.
If L3 fails (model unavailable, inference error), fail closed via the L4 path
(audit `JUDGE_UNAVAILABLE`, return 503).
9.9 L4 LLM judge

L4 uses Anthropic Haiku as a semantic judge.

L4 is conditional (not fired for every request).

In v1, L4 escalation signals (in addition to L3 mid-band score):

mostly non-Latin / non-ASCII text (covers Hebrew INJ-E3 and similar),
jailbreak/persona marker keywords detected by L2 but below hard block,
base64/hex blob found by L1,
NORMALIZATION_DIFFERENTIAL,
ENCODED_PAYLOAD_DETECTED,
possible non-English translate-and-execute heuristic,
unusually long message (configurable threshold).
9.10 L4 fail-closed policy

If L4 is triggered, it must not fail open.

If judge succeeds:

injection verdict → 400, audit JUDGE_INJECTION
benign verdict → continue to L5

If judge times out or errors:

return 503 detector_unavailable
audit status: error
include detected threat:
rule: "JUDGE_UNAVAILABLE"
patternName: "l4_timeout_or_error"
location: "input"
do not call the LLM provider.

Do not expose an L4 disable toggle in v1 secure mode.

A production-only disable toggle may be documented in v2, but must not be enabled by default and
must not be used for take-home acceptance.

9.11 L4 prompt contract

The judge prompt must:

frame user content as inert data,
instruct the judge not to follow the content,
require strict JSON output,
reject explanations outside JSON.

Expected judge output shape:

{
  "verdict": "benign_or_injection",
  "confidence": 0.0,
  "rule": "JUDGE_INJECTION",
  "reason": "short bounded reason"
}

Parsing rules:

invalid JSON → fail closed,
missing fields → fail closed,
ambiguous verdict → fail closed,
low-confidence benign with high-risk escalation signal → fail closed or block according to config.
9.12 L5 structural isolation

L5 wraps user content using randomized XML nonce delimiters.

Purpose:

reduce impact if something slips past L1–L4,
make provider instructions clearer,
keep untrusted content visually and structurally separated.

L5 is not an acceptance mechanism.

Do not claim that L5 “handles” required injection corpus items. Required corpus items must block
before provider call.

9.13 E-class indirect injection policy

Indirect injection and payload smuggling are handled as follows:

E-class required corpus:
  - L1 normalization/decode
  - L2 DELIMITER_INJECTION or INDIRECT_INJECTION
  - L4 fail-closed judge where L2 alone is insufficient (non-Latin, encoding anomaly)

Required behavior:

input block,
HTTP 400,
audit rule,
no provider call.

L5 and L6 are defense-in-depth only.

10. Security Control 4 — PII Redaction

PII redaction runs before injection detection and before provider call.

10.1 Required categories
Category	v1 behavior
Email	Regex redaction
Israeli phone	libphonenumber-js findPhoneNumbersInText with defaultCountry='IL' — covers IL mobile (05X), IL landlines (02/03/04/08/09), +972 international
International phone	Same libphonenumber-js call covers all country numbering plans — no separate regex
Israeli national ID	Context-or-checksum redaction
10.2 Redaction token format

Each match is replaced with:

[PII:<type>:<uuidv4>]

Examples:

[PII:email:550e8400-e29b-41d4-a716-446655440000]
[PII:phone:550e8400-e29b-41d4-a716-446655440000]
[PII:israeli_id:550e8400-e29b-41d4-a716-446655440000]
10.3 Token forgery resistance

Rehydration must only replace tokens present in the current request’s in-memory token map.

If a user supplies a fake token, leave it unchanged.

Never use a global token lookup for response rehydration.

10.4 Redaction order

Use this order:

email,
phone,
Israeli national ID.

This prevents phone digits from being re-matched as IDs after other substitutions.

10.5 Israeli national ID policy

Redact a 9-digit number if either:

there is an ID-context cue nearby, or
it passes the Israeli Teudat Zehut checksum and is a standalone token not in a math context.

Context cues include:

ID
national id
id_number
ת.ז
תעודת זהות

Math guard:

do not redact checksum-valid 9-digit numbers when adjacent to math operators or decimals,
bias toward recall when context clearly indicates identity.
10.6 JSON payloads

Treat JSON content as text for redaction.

Do not rely on JSON field names only. Regexes must find values inside strings.

10.7 PII vault

The request-local token map is:

held in memory during the request,
used for response rehydration,
encrypted into PiiVault during audit write,
never logged raw.
11. Security Control 5 — Output Validation

LLM output is untrusted.

The gateway must buffer the full response before returning anything to the client.

No response streaming in v1.

11.1 L6 validation order

L6 runs before PII rehydration.

Passes:

Secret pattern detection
Injection echo / compromise marker detection
System/context disclosure marker detection
Outbound PII DLP scan
Render/exfil guard
11.2 Pass 1 — Secret patterns

Block the whole response if it contains secret-looking patterns.

Required patterns:

Rule	Examples
OPENAI_KEY_LEAK	sk-...
ANTHROPIC_KEY_LEAK	sk-ant-...
AWS_ACCESS_KEY_LEAK	AKIA...
JWT_LEAK	JWT-shaped three-part token

Action:

block whole response,
return clear error with correlation ID,
audit status: blocked,
do not return partial secret-containing output.
11.3 Pass 2 — Injection echo / compromise markers

Scan the model response independently of inbound detection.

This catches cases where input detection missed something but the model output reveals compromise.

Required marker families:

Rule	Purpose
OUTPUT_INJECTION_ECHO	Response repeats known injection phrases or delimiter payloads
COMPROMISE_MARKER	Response contains known bypass/compliance markers
STRUCTURED_BYPASS_ECHO	Response emits JSON or structured text indicating filters disabled

Action:

block whole response,
audit status: blocked,
include rule and pattern name,
do not return the LLM output.
11.4 Pass 3 — System/context disclosure markers

v1 adds deterministic semantic-leak marker families.

This is not a full semantic output judge. It is a bounded deterministic guard for obvious leaks.

Pattern families:

Rule	Catch examples
SYSTEM_PROMPT_LEAK	“my system instructions are”, “the hidden prompt says”, “system prompt:”
DEVELOPER_MESSAGE_LEAK	“developer message:”, “internal policy:”, “developer instructions:”
CONTEXT_DUMP	“here is the full conversation”, “prior context:”, “full context dump”
CONFIG_DISCLOSURE	“environment variables:”, “process.env”, “config values”, “API key:”
JUDGE_BYPASS_MARKER	“filters disabled”, “debug mode enabled”, “bypass true”

Action:

block whole response,
audit status: blocked,
include rule and pattern name.

Important limitation:

v1 does not claim to catch every paraphrased semantic leak. A separate semantic output judge is v2.

11.5 Pass 4 — Outbound PII DLP

Before returning the response, scan the tokenized model output for new PII values using the same
v1 PII categories:

email,
phone,
Israeli national ID.

If output contains PII that is not a current request-local token:

block the response,
audit OUTBOUND_PII,
do not return the PII.

This prevents the model from introducing new PII unrelated to the caller’s token map.

Allowed:

request-local PII tokens may be rehydrated after output validation,
fake or unknown tokens are not rehydrated.
11.6 Pass 5 — Render/exfil guard

Strip or block render-based exfiltration patterns.

v1 behavior:

strip markdown images,
strip HTML image tags,
strip suspicious external links if configured.

Examples:

![alt](https://example.com/pixel)
<img src="https://example.com/pixel">

Action:

sanitize span,
return remaining response,
audit sanitized render guard event.

If the render pattern also contains secrets, injection echo, or PII, the earlier block rule wins.

12. Security Control 6 — Audit Log
12.1 AuditLog model

AuditLog contains no raw PII.

Field	Type	Notes
correlationId	string	Unique index
timestamp	Date	Indexed
apiKeyId	ObjectId	Indexed
anonymizedKeyId	string	HMAC-SHA256 of API key ID
model	string optional	Requested model
requestHash	string	SHA-256 of redacted request
responseHash	string nullable	SHA-256 of tokenized response or null
detectedThreats	array	{ rule, patternName, location }[]
sanitizedThreatContent	string[]	Optional sanitized snippets, never raw PII
patternSetVersion	string	Version of detector rules
latencyMs	number	End-to-end latency
status	enum	allowed, blocked, error
errorCode	string optional	For errors

TTL:

AUDIT_LOG_TTL_DAYS = 90 default
12.2 PiiVault model
Field	Type	Notes
correlationId	string	Unique index
ciphertext	Buffer	AES-256-GCM encrypted token map
iv	Buffer	Random per record
authTag	Buffer	GCM auth tag
createdAt	Date	TTL source

TTL:

PII_VAULT_TTL_DAYS = 30 default
12.3 Audit write policy

Synchronous in v1.

A successful /v1/chat response must not be emitted until:

AuditLog write succeeds, and
PiiVault write succeeds if PII was redacted.

If audit write fails:

return 500,
do not return LLM content,
log error with correlation ID only.
12.4 Audit reveal

GET /v1/audit?reveal=<correlationId>:

requires admin role,
requires pii:reveal scope,
reveals token map for one correlation ID only,
writes a second audit event recording the reveal action.

No bulk reveal in v1.

13. Security Control 7 — Secrets Handling
Provider keys come from env vars only.
Crypto keys come from env vars only.
No secrets in code.
No secrets in commits.
No secrets in logs.
.env is gitignored.
.env.example contains placeholders only.
CI runs gitleaks.

Required env vars:

MONGO_URI
REDIS_URL
LOG_PSEUDONYM_SECRET
PII_ENCRYPTION_KEY
ANTHROPIC_API_KEY optional for degraded startup

If ANTHROPIC_API_KEY is missing:

service starts,
provider is degraded,
/v1/chat returns 503.

If required crypto/database config is missing:

service fails startup.

Redis and MongoDB are both required at startup. server.ts connects them in parallel
(Promise.all) before binding the HTTP port. If either is unreachable, main() throws
and the process exits with code 1. There is no degraded mode without a datastore —
rate limiting and audit writes are security controls, not optional features.
14. LLM Provider Integration
14.1 Provider

Use Anthropic for v1.

llmProvider.ts exposes:

chat(input: ProviderChatInput): Promise<ProviderChatOutput>

No app-level provider stubs.

Tests may mock the provider interface.

14.2 Non-streaming only

v1 is non-streaming.

Reason:

output validation requires the complete response,
streaming would expose unvalidated tokens.
14.3 Provider request content

Provider receives:

redacted user content,
L5 structurally isolated content,
hardened system prompt.

Provider must never receive raw PII detected by v1 redactor.

14.4 Model allowlist

If apiKey.allowedModels is present and non-empty:

requested model must be in the allowlist,
otherwise return 403.

If requested model is not available for configured provider:

return 422.
14.5 Error mapping
Provider condition	Gateway response
Missing provider key	503
Provider timeout	504
Provider rate limit	503 or 502
Provider 5xx	502 or 503
Invalid model/provider mismatch	422

All provider errors must be audited as status: error.

15. Infrastructure and Docker
15.1 Required compose path

docker-compose.yml must be boring and reliable.

Required services only:

app
mongo
redis

This is the path evaluators should run.

Command:

docker-compose up --build

The stack must start even when ANTHROPIC_API_KEY is absent. In that case, provider status is
degraded and /v1/chat returns 503.

15.2 Optional production-like compose

docker-compose.prod.yml may include:

nginx
seq
redis replica
redis sentinel

Do not make the required take-home path depend on these optional services.

15.3 Graceful shutdown

SIGTERM/SIGINT → server.close() → drain in-flight requests → disconnect Mongoose → process.exit(0).
Hard-exit fallback: 10 000 ms (SHUTDOWN_DRAIN_MS constant in server.ts).

Rationale for 10 s: matches Docker's default stop_grace_period, which sends SIGKILL at 10 s.
Setting our drain window equal to Docker's grace period means we always self-exit cleanly before
Docker force-kills us. The drain window must cover the slowest in-flight request — for an LLM proxy,
that is the provider round-trip (typically 2–8 s), so 10 s provides headroom without exceeding
Docker's patience.

15.4 Dockerfile

Requirements:

multi-stage build,
non-root runtime user,
install production dependencies only in runtime,
copy compiled dist,
no secrets baked into image.
15.5 CI

GitHub Actions workflow at .github/workflows/ci.yml runs on every push and PR:

1. npm ci
2. npm run lint         (ESLint — no-console, no-process-env, no-explicit-any)
3. npm run typecheck    (tsc --noEmit)
4. npm test             (vitest — secrets generated dynamically, no CI secrets needed)
5. gitleaks/gitleaks-action@v2 with fetch-depth: 0 (full history scan)

.gitleaks.toml allowlists test fixture strings (synthetic values, never real secrets).

Key prefix constants (KEY_PREFIX_CLIENT, KEY_PREFIX_ADMIN, KEY_PREFIX_BASE) live in
src/constants.ts and are the single source of truth for key shape — referenced by both
auth middleware and seed script.
16. Required Tests

Tests are part of the design. Implement test-first where practical.

16.1 Auth tests
missing key → 401
malformed key → 401
unknown prefix → 401
wrong secret → 401
inactive key → 401
valid client key can call /v1/chat
client key cannot call /v1/audit → 403
admin key can call /v1/audit
admin without pii:reveal cannot reveal PII
admin with pii:reveal can reveal one record
16.2 Rate limit tests
default 30/min enforced
per-key override enforced
concurrent requests cannot exceed limit
Redis unavailable returns 503
sorted-set members are unique under same-millisecond requests
16.3 PII tests

Required:

email redacted
Israeli local phone redacted
+972 phone redacted
international phone redacted
Israeli national ID with context redacted
valid checksum Israeli national ID redacted
JSON string values redacted
multiple PII values redacted
fake PII token is not rehydrated
only request-local tokens are rehydrated
PiiVault stores encrypted token map
16.4 Injection corpus tests

For every required corpus category, add at least one test fixture and one variation test.

Rows:

A direct instruction override
B1 system-prompt extraction
B2 prior-context extraction
B3 env/config/API-key probe
C1 unrestricted persona
C2 interpreter/filesystem roleplay probe
C3 forced structured-output bypass
E1 forged end-of-user/system marker
E2 HTML-comment smuggling
E3 non-English translate-and-execute

Expected for each injection test:

HTTP 400
no provider call
audit status: blocked
audit includes detectedThreats[0].rule
audit includes detectedThreats[0].patternName
16.5 L3 segmentation tests

Required tests:

Test	Expected
attack after 1,000 benign tokens	blocked or escalated then blocked
attack split across adjacent windows	blocked or escalated then blocked
attack split across two messages	blocked or escalated then blocked
attack in final 200 tokens	blocked or escalated then blocked
oversized input beyond scan budget	413 or safe reject; no provider call
16.6 L4 fail-closed tests
L4 triggered + judge returns injection → 400
L4 triggered + judge returns benign → provider called
L4 triggered + judge timeout → 503, no provider call
L4 triggered + invalid JSON → 503 or blocked, no provider call
L4 not triggered → no judge call
16.7 Normalization tests
confusables change triggers NORMALIZATION_DIFFERENTIAL
control characters stripped
base64-looking payload decoded and inspected
encoded injection blocks or escalates
L4 unavailable after normalization differential fails closed
16.8 Output validation tests
OpenAI-style key blocks
Anthropic-style key blocks
AWS key blocks
JWT-shaped token blocks
injection echo blocks
compromise marker blocks
system prompt leak marker blocks
developer message leak marker blocks
context dump marker blocks
config disclosure marker blocks
outbound new email blocks
outbound new phone blocks
outbound new Israeli ID blocks
markdown image stripped or blocked according to policy
16.9 ReDoS/performance tests

v1 does not use node-re2, so add performance tests for pathological long inputs.

Example test inputs:

const pathologicalInputs = [
  "ignore ".repeat(50_000),
  "[".repeat(50_000) + "SYSTEM" + "]".repeat(50_000),
  "<!--".repeat(20_000) + "x",
  "a".repeat(100_000) + "@",
  "sk-" + "A".repeat(100_000),
  "eyJ" + ".".repeat(50_000),
];

Test shape:

it("runs L2 regexes within budget on pathological inputs", () => {
  for (const input of pathologicalInputs) {
    const start = performance.now();
    inputInjectionScanner.scan(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  }
});

it("runs L6 regexes within budget on pathological inputs", () => {
  for (const input of pathologicalInputs) {
    const start = performance.now();
    outputValidator.scan(input);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  }
});

The exact threshold may be adjusted for CI stability, but tests must catch seconds-long hangs.

16.10 Audit tests
allowed request writes AuditLog
blocked input writes AuditLog
output-blocked response writes AuditLog
provider error writes AuditLog
audit write failure prevents successful response
PII request writes PiiVault
reveal action writes a second audit event
16.11 Health tests
/livez returns 200 if process is up
/healthz returns healthy when dependencies/provider ready
/healthz returns degraded when provider key missing
/healthz does not expose detailed dependency names in public response

17. Implementation Sequence

Build in this order.

Scaffold TypeScript strict, Express, config, logger, correlation ID.
Dockerfile and boring docker-compose.yml with app + mongo + redis.
Mongoose models: ApiKey, AuditLog, PiiVault.
Auth and admin gate.
Redis rate limiter.
PII redactor and token map.
L1 normalization.
L2 input pattern scanner.
L4 judge wrapper with fail-closed behavior (L3 deferred to v2 — see §17.11).
L5 structural isolation.
Anthropic provider integration.
L6 output validator.
Synchronous audit write and PiiVault encryption.
Routes: /v1/chat, /v1/audit, /healthz, /livez.
Full corpus tests and acceptance tests.
CI: lint, test, gitleaks.
19. Guardrails for Claude Code

Claude Code must follow these implementation guardrails:

Do not add streaming responses.
Do not stub the provider in application code.
Do not silently disable L2 or L4.
If L4 is triggered and unavailable, fail closed.
Do not log raw prompts, raw PII, raw API keys, or raw injection strings.
Do not return LLM output if audit write fails.
Do not implement v2 features unless explicitly asked.
Do not broaden /healthz public output beyond healthy/degraded.
Do not trust arbitrary X-Forwarded-For.
Do not claim L5 structural isolation satisfies input-blocking requirements.
Do not scan only the first classifier window.
Do not rehydrate unknown or user-forged PII tokens.
Do not paste the full attack corpus into source comments or logs.
Tests must assert behavior, not just line coverage.
20. Final Acceptance Checklist

Before submission, verify:

docker-compose up --build starts app + mongo + redis.
Missing Anthropic key does not crash startup.
/healthz returns degraded if provider key missing.
/v1/chat returns 503 if provider key missing.
Valid provider key results in a real Anthropic call.
All required injection corpus cases return 400.
All required injection corpus cases write audit threat rule/pattern.
Required PII categories are redacted before provider call.
PII is reversible only through scoped audit reveal.
Output validation blocks secrets.
Output validation blocks injection echoes.
Output validation blocks obvious system/context disclosure markers.
Outbound new PII is blocked.
Regex performance tests pass.
Gitleaks passes.
README documents limitations and v2 work.

17.11 L3 v2 — Llama Prompt Guard 2 (multilingual) and audit-corpus fine-tuning

Two-step v2 upgrade path for L3:

**Step 1 — Swap to Llama Prompt Guard 2 (`meta-llama/Llama-Prompt-Guard-2-86M`)**

- Multilingual: covers Hebrew, Russian, Arabic and other scripts.
  Eliminates the v1 structural reliance on L4 for non-English attacks.
- Smaller (86 M params vs v1's 139 M) and prompt-injection + jailbreak-specific.
- Released by Meta, actively maintained.
- Requires an org HuggingFace token (model is gated). Once `HF_TOKEN` is set in production,
  swap the `L3_CLASSIFIER_MODEL` env var; no code change needed.

**Step 2 — Dedicated classifier fine-tuned on our audit corpus**

Replace the general-purpose model with one fine-tuned on this gateway's own audit corpus
(`sanitizedThreatContent[]` accumulated from blocked requests) to capture organization-specific
attack patterns and adversarial paraphrases.

- Periodic offline training job consumes `sanitizedThreatContent` + benign samples
- Multilingual base (xlm-roberta-base or LPG2 itself) fine-tuned with the audit corpus
- Quantized to int8, swapped in via the same @huggingface/transformers pipeline
- A/B run alongside step 1 model before promotion; promotion gated on
  precision/recall improvement on a held-out adversarial set