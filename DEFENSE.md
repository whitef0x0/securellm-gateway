# Interview Defense Guide

## Phase 1 (0–3 min): First AI interaction

They will check your answer against PROMPTS.md.

**Your answer:**
> "I uploaded the full challenge PDF and asked Claude to produce a structured architecture plan covering
> all 7 security layers, technology choices with rationale, and a build order. I then asked a second LLM
> (via a separate review prompt in PROMPTS.md §3b) to red-team that plan before writing a single line of code.
> The review caught three issues I incorporated: the pipeline order was wrong — PII redaction had to run
> before injection detection so the L4 judge never sees raw PII; the healthz route was leaking internal
> component state; and the DeBERTa segmentation strategy had a token-window truncation bypass.
> I rejected the reviewer's suggestion to add a streaming mode — the brief requires holistic output
> validation, which is impossible token-by-token."

Point to: `PROMPTS.md §3a` (architecture prompt), `PROMPTS.md §3b` (security review prompt), `PROMPTS.md §4` (what you rejected).

---

## Phase 2 (3–13 min): Architecture walkthrough

### The pipeline — lead with order, not just contents

```
request → auth → rate-limit → PII-redact → L1-normalize → L2-regex
        → L3-LlamaPromptGuard → L4-Haiku-judge (conditional) → L5-XML-isolate
        → LLM → L6-output-validate → re-hydrate → audit-write → response
```

Key point to make: **PII runs before injection detection**. The L3 classifier, the L4 LLM judge, and
the provider (Anthropic) never see raw PII values. They see `[PII:email:uuid]` tokens. This is the
most important ordering decision.

### Most interesting decision: layered detection — regex + ML classifier + LLM judge

Explain the three-layer semantic stack:
- **L2 regex** — deterministic, named rules (`ROLE_OVERRIDE`, `SYSTEM_PROMPT_EXTRACTION`, ...).
  Fast, explainable, audit-log records which rule fired. Catches obvious patterns.
- **L3 Llama Prompt Guard 2** (86M params via `@huggingface/transformers`) — multilingual fine-tuned
  classifier from Meta. Loaded once at startup, runs CPU-only. Score band: ≥0.85 → block,
  0.5–0.85 → escalate to L4, <0.5 → continue. Catches paraphrases, jailbreaks, non-English attacks
  the regex misses.
- **L4 Anthropic Haiku judge** — semantic backstop for L3 mid-confidence cases. Fail-closed (503 on
  timeout/error). Most expensive layer; fires only on real ambiguity.

Why this stack — and why Llama Prompt Guard 2 over DeBERTa:
- **Llama Prompt Guard 2** is multilingual (covers Hebrew, Russian, Arabic). DeBERTa-v3-small is
  English-only — would still rely on L4 for non-English INJ-E3 attacks.
- It's trained specifically for prompt injection + jailbreaks (DeBERTa-v3-small was a general
  classification model fine-tuned by a third party).
- Released by Meta, actively maintained. Same architecture commercial firewalls ship
  (Lakera, Microsoft Prompt Shields, NVIDIA NeMo Guardrails all use small fine-tuned transformers).
- Accessed via `@huggingface/transformers` (pure JS/WASM) — **no native module compilation pain**.
  Direct onnxruntime-node would have meant fighting platform-specific builds in CI (the classic
  arm64-dev-vs-x86_64-CI trap). Transformers.js bundles the tokenizer and works the same on every host.

Phone redaction: **`libphonenumber-js`** (Google's libphonenumber port) instead of custom regex.
Default country `IL` lets it resolve national numbers without country code; covers every country's
numbering plan including IL mobile (05X), IL landlines (02/03/04/08/09), +972 international.
Validated against actual numbering plans — fewer false positives, no ReDoS surface, and no
maintenance burden for new country formats. Same library used in both inbound PII redaction
and L6 outbound PII DLP.

### Most interesting security decision: auth key design

### Most interesting security decision: auth key design

Why `<keyIdPrefix>.<secret>` with a public lookup handle?

- argon2id is memory-hard — verifying against ALL keys = O(n) argon2 = self-DoS
- Public prefix = O(1) DB lookup, then single verify
- Industry standard (Stripe, GitHub use same pattern)
- Constant-time comparison is `argon2.verify()` internally — no manual `timingSafeEqual`

### Scope cuts — be proactive, don't wait to be asked

| Cut | Why |
|---|---|
| No streaming | Holistic output validation requires full response. Streaming shows unvetted output. |
| No nginx in required path | Evaluators run `docker-compose up`. Keep it boring. |
| No node-re2 | ReDoS perf tests cover the risk. node-re2 deferred to v2. |
| DeBERTa-v3-small over Llama Prompt Guard 2 | English-only vs multilingual; general-purpose vs prompt-injection-specific. Going with Llama Prompt Guard 2 was strictly better on coverage. |
| node-onnxruntime direct over Transformers.js | Native module = platform-specific builds. Transformers.js is pure JS and bundles the tokenizer. Same ONNX backend internally. |
| Dedicated audit-corpus-trained classifier | v2 (arch §17.11) — fine-tune on our own `sanitizedThreatContent` corpus to capture org-specific paraphrases. Llama Prompt Guard 2 covers general patterns first. |
| L4 disable toggle | Arch §19 guardrail: no disable toggle in v1. Fail-closed only. |
| Bulk PII reveal | Reveal is per-correlationId only, self-auditing. Bulk export = separate scoped feature. |

### Quick code tour (90 seconds, file by file)

If asked to walk through the code, follow the request path:

```
src/server.ts             — process bootstrap: connect Mongo+Redis in parallel,
                             load L3 classifier model, bind HTTP port, SIGTERM drain
src/app.ts                — Express wiring: helmet → correlationId → pino-http →
                             json(bodyLimit) → /healthz → /livez → /v1 (auth →
                             rateLimit → audit/chat routers)
src/config/index.ts       — single zod-validated env source; no other file reads process.env

src/middleware/
  correlationId.ts        — UUID per request, X-Request-Id response header
  auth.ts                 — x-api-key parse, prefix lookup, argon2.verify, identical 401
  rateLimiter.ts          — Redis Lua sliding window, unique member, fail-closed 503
  requireAdmin.ts         — admin role gate (post-auth, returns 403)

src/detection/
  normalize.ts            — L1: NFKC + control strip + confusables fold + base64/hex decode
  scanner.ts              — L2 + L2.5: regex pre-filter + escalation signals
  patterns/inputPatterns  — L2 named rules (ROLE_OVERRIDE, CREDENTIAL_PROBE, ...)
  classifier.ts           — L3: Llama Prompt Guard 2 via @huggingface/transformers
                             (multilingual, loaded once at startup, score-band)
  llmJudge.ts             — L4: Haiku judge, fail-closed on timeout/error
  structuralIsolation.ts  — L5: random XML nonce wrap of user content
  outputValidator.ts      — L6: 5 passes (secrets, echo, disclosure, outbound PII via
                             libphonenumber-js DLP, render guard)
  piiRedactor.ts          — inbound PII redact: email (regex), phone (libphonenumber-js
                             findPhoneNumbersInText), Israeli ID (checksum or context cue)

src/services/
  llmProvider.ts          — Anthropic SDK wrapper, ProviderError class, error mapping
  auditLogger.ts          — writeAudit (AuditLog + encrypted PiiVault), hashContent

src/routes/
  chat.ts                 — POST /v1/chat pipeline (the orchestrator — read top-down)
  audit.ts                — GET /v1/audit (admin) + ?reveal=<id> (pii:reveal scope)
  health.ts / livez.ts    — readiness vs liveness

src/models/               — Mongoose schemas: ApiKey, AuditLog, PiiVault
src/crypto/               — fieldCrypto (AES-256-GCM for vault), pseudonym (HMAC for logs)
src/scripts/seed.ts       — bootstrap admin + client keys, prints raw secret once
```

The single file that demonstrates the design is `src/routes/chat.ts` — it reads top-down as
the pipeline: validate body → model allowlist → PII redact → L1/L2 scan → (L3 score → L4
judge if escalate) → L5 wrap → provider → L6 validate → re-hydrate → audit-then-respond.

---

## Phase 3 (13–25 min): Likely targeted questions

**"Why argon2id over bcrypt?"**
> argon2id is the 2023 OWASP recommendation. Memory-hard (defeats GPU/ASIC attacks). bcrypt is
> CPU-hard only. For API keys that are long-lived and high-value, memory-hardness matters.

**"Why identical 401s for all auth failures?"**
> No key-existence oracle. If wrong-prefix returns 404 and wrong-secret returns 401, an attacker can
> enumerate valid prefixes. Identical responses force brute-force across both dimensions simultaneously.

**"Why HMAC for log pseudonyms instead of plain SHA-256?"**
> Plain SHA-256 of a low-cardinality ObjectId is trivially reversible — rainbow table in seconds.
> HMAC-SHA256 with a server secret makes the pseudonym non-reversible without that secret.
> Fast enough to compute on every log line.

**"Why fail-closed on L4 (503) instead of fail-open?"**
> The brief's threat model: an attacker who can cause L4 to fail (provider outage, timeout) would
> get a free pass through the security layer. Fail-open = DoS-as-bypass. 503 is honest — the
> detector is unavailable, we can't guarantee safety, we don't proceed.

**"How did you use AI in this project?"**
> Point to PROMPTS.md. Four patterns: (1) architecture generation + red-team review before coding,
> (2) TDD implementation with per-file approval — I reviewed every file before it was written,
> (3) parallel agents on non-overlapping workstreams — Agent A owned L5 structural isolation and
> the Anthropic provider service; Agent B owned PII redaction, L1/L2 detection, and the L4 judge.
> Both ran simultaneously with no source file conflicts; `llmProvider.ts` is a shared dependency
> that Agent B's judge imports. (4) targeted debugging prompts mid-implementation (e.g. the
> rate-limiter 429 issue, the `'reveal' in req.query` narrowing fix).
> PROMPTS.md §4 documents a specific output I rejected and why.

**"Why Llama Prompt Guard 2 and not DeBERTa?"**
> Three reasons. (1) Llama Prompt Guard 2 is multilingual — DeBERTa-v3-small-prompt-injection-v2
> is English-only and weak on jailbreaks, which means non-English attacks like INJ-E3 (Hebrew
> translate-and-execute) would still depend on L4. Llama Prompt Guard 2 catches them at L3.
> (2) It's trained specifically for prompt injection and jailbreaks; DeBERTa-v3-small was a
> general-purpose classifier fine-tuned by a third party. (3) Released by Meta, actively
> maintained. Same architecture class that Lakera, Microsoft Prompt Shields, and NVIDIA NeMo
> Guardrails all ship under the hood — small fine-tuned transformer classifier.

**"Why @huggingface/transformers and not onnxruntime-node?"**
> Both use ONNX Runtime under the hood, but Transformers.js wraps it as pure JS/WASM and bundles
> the tokenizer. onnxruntime-node is a native module — every platform-specific binary, every
> Docker build, every arm64-dev-vs-x86_64-CI mismatch becomes my problem. Transformers.js works
> identically on every host with one `npm install`. Integration code dropped from ~200 LOC to ~30.

**"Why libphonenumber-js over regex for phone redaction?"**
> Phone-number formats are not a thing you write a regex for and finish — Israeli landlines alone
> have 5 prefix variants, plus mobile (05X), plus +972 international, plus every other country.
> Google's libphonenumber is the de-facto standard, maintained by people who do this full-time,
> and validates against actual numbering plans instead of just matching shapes. The npm port has
> `findPhoneNumbersInText(text, defaultCountry)` exactly for our use case — returns spans, no
> ReDoS surface, covers every country. Three lines of integration code instead of an unbounded
> regex maintenance burden.

**"What doesn't this protect against?"**
> README has a section. Key items: prompt injection via documents/RAG (no RAG endpoint in v1),
> multi-turn context poisoning (stateless gateway, no session), exfiltration via steganography,
> model weights themselves being compromised.

**"Walk me through a blocked request end-to-end."**
> 1. Correlation ID assigned
> 2. Auth: DB lookup by prefix, argon2 verify
> 3. Rate limit: Redis sorted-set sliding window check
> 4. PII redact: regex scan, tokenize, encrypt map to PiiVault
> 5. L1: NFKC normalize, control-char strip (detection copy)
> 6. L2: regex pattern match fires → blocked here with rule + patternName
> 7. AuditLog written (fail-closed — 500 if write fails)
> 8. HTTP 400 returned with `{ error, correlationId, detectedThreats[] }`

---

## Phase 4 (25–30 min): Live edit

They will ask for a small modification. Likely candidates:

- Add a new config field with validation
- Add a test case to an existing test file
- Change a rate limit default
- Add a new log field

**Your approach:**
1. Open Claude Code in the terminal
2. State what you're about to do before doing it
3. Show the test first, get it failing, then implement
4. Run `npm test` live — let them see it go green

Practice this sequence now so it's muscle memory on the day.
