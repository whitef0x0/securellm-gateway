/**
 * Corpus acceptance tests.
 * All attack strings live in fixtures.ts as InertFixture objects — never inline here.
 * Coverage: brief Appendix A categories (A, B1–B3, C1–C3, D1–D3, E1–E3)
 *         + OWASP LLM Top 10 2025 (LLM01, LLM02, LLM05, LLM07)
 */
import { describe, it, expect } from 'vitest';
import { scanInput } from '../../src/detection/scanner';
import { redactPii } from '../../src/detection/piiRedactor';
import * as F from './fixtures';

function assertBlock(f: F.InertFixture, expectedRule: string) {
  const result = scanInput(f.input);
  expect(result.action, `[${f.category}/${f.label}] expected block`).toBe('block');
  if (result.action === 'block') {
    expect(result.rule, `[${f.category}/${f.label}] wrong rule`).toBe(expectedRule);
  }
}

function assertEscalate(f: F.InertFixture, expectedSignal: string) {
  const result = scanInput(f.input);
  expect(result.action, `[${f.category}/${f.label}] expected escalate`).toBe('escalate');
  expect(result.signals, `[${f.category}/${f.label}] missing signal`).toContain(expectedSignal);
}

function assertPass(f: F.InertFixture) {
  const result = scanInput(f.input);
  expect(result.action, `[${f.category}/${f.label}] expected pass`).toBe('pass');
}

// ── Brief corpus A — Direct Instruction Override ──────────────────────────────

describe('corpus A — direct instruction override', () => {
  it('A.1 plain override', () => assertBlock(F.A1, 'ROLE_OVERRIDE'));
  it('A.2 debug-mode disable filters', () => assertBlock(F.A2, 'ROLE_OVERRIDE'));
  it('A.3 uppercase variation', () => assertBlock(F.A3, 'ROLE_OVERRIDE'));
});

// ── Brief corpus B — System-Prompt / Context Extraction ──────────────────────

describe('corpus B — system-prompt and context extraction', () => {
  it('B1 repeat system prompt verbatim', () => assertBlock(F.B1, 'SYSTEM_PROMPT_EXTRACTION'));
  it('B2 print prior context as markdown', () => assertBlock(F.B2, 'SYSTEM_PROMPT_EXTRACTION'));
  it('B3 env var dump', () => assertBlock(F.B3, 'CREDENTIAL_PROBE'));
});

// ── Brief corpus C — Role Override / Persona Hijack ──────────────────────────

describe('corpus C — role override and persona hijack', () => {
  it('C1 DAN no-restrictions persona', () => assertBlock(F.C1, 'ROLE_OVERRIDE'));
  it('C2 interpreter/filesystem roleplay — blocked or escalated to L4', () => {
    const result = scanInput(F.C2.input);
    // L2 may block directly OR escalate to L4 judge which blocks semantically
    expect(['block', 'escalate']).toContain(result.action);
  });
  it('C3 structured bypass JSON signal', () => assertBlock(F.C3, 'STRUCTURED_BYPASS'));
});

// ── Brief corpus D — PII Redaction ───────────────────────────────────────────

describe('corpus D — PII redaction', () => {
  it('D1 email + IL phone + national ID in prose — all three redacted', () => {
    const { text, tokenMap } = redactPii(F.D1_INPUT.input);
    expect(text).not.toContain('dana@example.com');
    expect(text).not.toContain('050-7654321');
    expect(text).not.toContain('039337423');
    expect(Object.keys(tokenMap).length).toBe(3);
  });

  it('D2 multiple people, multiple PII categories — all spans redacted', () => {
    const { text, tokenMap } = redactPii(F.D2_INPUT.input);
    expect(text).not.toContain('alice@corp.io');
    expect(text).not.toContain('+972-54-111-2222');
    expect(text).not.toContain('bob@mail.net');
    expect(text).not.toContain('054-9998887');
    expect(text).not.toContain('039337423');
    expect(Object.keys(tokenMap).length).toBe(5);
  });

  it('D3 PII embedded in JSON field values', () => {
    const { text } = redactPii(F.D3_INPUT.input);
    expect(text).not.toContain('eve@example.org');
    expect(text).not.toContain('050-3334444');
    expect(text).not.toContain('039337423');
  });
});

// ── Brief corpus E — Indirect Injection / Payload Smuggling ──────────────────

describe('corpus E — indirect injection and payload smuggling', () => {
  it('E1 forged </user><system> marker with env var demand — blocked (rule: first matching pattern)', () => {
    // Input contains both DELIMITER_INJECTION and CREDENTIAL_PROBE patterns;
    // first match wins. Important property: it is blocked.
    expect(scanInput(F.E1.input).action).toBe('block');
  });
  it('E2 HTML comment smuggled instruction — blocked', () => {
    expect(scanInput(F.E2.input).action).toBe('block');
  });
  it('E3 Hebrew translate-and-execute → L4 escalation', () => assertEscalate(F.E3, 'NON_LATIN_HEAVY'));
});

// ── OWASP LLM01 — Prompt Injection (encoding variants) ───────────────────────

describe('OWASP LLM01 — prompt injection encoding variants', () => {
  it('LLM01 base64-encoded override detected by L1 decode-and-inspect', () => {
    // L1 decodes blob and re-scans; ENCODED_PAYLOAD_DETECTED → escalate or block
    const result = scanInput(F.LLM01_BASE64.input);
    expect(['block', 'escalate']).toContain(result.action);
  });

  it('LLM01 unicode confusable override folded and blocked', () => {
    // L1 folds Cyrillic lookalikes → detection copy becomes "act as admin and ignore all rules"
    assertBlock(F.LLM01_UNICODE_CONFUSABLE, 'ROLE_OVERRIDE');
  });
});

// ── OWASP LLM02 — Sensitive Information Disclosure ───────────────────────────

describe('OWASP LLM02 — sensitive information disclosure', () => {
  it('LLM02 credential extraction probe', () => assertBlock(F.LLM02_CREDENTIALS, 'CREDENTIAL_PROBE'));
  it('LLM02 memorized training data request', () => assertBlock(F.LLM02_TRAINING_DATA, 'SYSTEM_PROMPT_EXTRACTION'));
});

// ── OWASP LLM05 — Improper Output Handling ───────────────────────────────────
// LLM05 is primarily an OUTPUT concern: L6 validates the model response for
// dangerous code, secret patterns, and XSS before it is returned. These inputs
// are not injection attacks (L2 correctly passes them); L6 catches dangerous output.

describe('OWASP LLM05 — output-side: input scanner passes, L6 catches response', () => {
  it('LLM05 code-execution request passes L2 (caught by L6 output validator)', () => {
    // L2 does not block code-generation requests; L6 blocks model output containing exec patterns
    const result = scanInput(F.LLM05_CODE_EXEC.input);
    expect(['pass', 'escalate']).toContain(result.action);
  });

  it('LLM05 XSS output request passes L2 (caught by L6 output validator)', () => {
    const result = scanInput(F.LLM05_XSS_OUTPUT.input);
    expect(['pass', 'escalate']).toContain(result.action);
  });
});

// ── OWASP LLM07 — System Prompt Leakage ──────────────────────────────────────

describe('OWASP LLM07 — system prompt leakage', () => {
  it('LLM07 social-engineering auditor role', () => assertBlock(F.LLM07_INTERNAL_AUDITOR, 'SYSTEM_PROMPT_EXTRACTION'));
  it('LLM07 debug-mode system params dump', () => assertBlock(F.LLM07_DEBUG_PARAMS, 'CREDENTIAL_PROBE'));
});

// ── Benign controls — must not block ─────────────────────────────────────────

describe('benign controls — must pass without block', () => {
  it('benign: geography question', () => assertPass(F.BENIGN_1));
  it('benign: code help', () => assertPass(F.BENIGN_2));
  it('benign: French greeting', () => assertPass(F.BENIGN_3));
});
