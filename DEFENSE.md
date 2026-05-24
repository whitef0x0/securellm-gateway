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
        → L3-DeBERTa → L4-Haiku-judge → L5-XML-isolate
        → LLM → L6-output-validate → re-hydrate → audit-write → response
```

Key point to make: **PII runs before injection detection**. The LLM judge (L4) and the provider (Anthropic)
never see raw PII values. They see `[PII:email:uuid]` tokens. This is the most important ordering decision.

### Most interesting decision: L3+L4 escalation band

Don't just say "I used DeBERTa." Explain the score-band logic:
- P(injection) ≥ 0.85 → block (L3 confident)
- P(injection) ≤ 0.15 → allow (L3 confident)
- Middle band **or** escalation signal → escalate to L4 Haiku judge

Escalation signals: non-ASCII-heavy input, jailbreak marker keywords, very long message, base64/hex blob.

Why this matters: L4 (Haiku) costs money and latency. Firing it only on ambiguous inputs keeps p95 latency
acceptable for normal EN traffic while covering DeBERTa's blind spots (Hebrew injections, DAN jailbreaks).

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
| L4 disable toggle | Arch §19 guardrail: no disable toggle in v1. Fail-closed only. |
| Bulk PII reveal | Reveal is per-correlationId only, self-auditing. Bulk export = separate scoped feature. |

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
> Point to PROMPTS.md. Three patterns: (1) architecture generation + red-team review before coding,
> (2) TDD implementation with per-file approval — I reviewed every file before it was written,
> (3) code review questions mid-implementation (e.g. caught `!== undefined` vs `'reveal' in req.query`).
> PROMPTS.md §4 documents a specific output I rejected and why.

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
