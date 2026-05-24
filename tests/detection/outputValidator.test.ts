import { describe, it, expect } from 'vitest';
import { validateOutput } from '../../src/detection/outputValidator';

describe('outputValidator', () => {
  // Pass 1 — secret patterns
  it('blocks Anthropic key in output', () => {
    const result = validateOutput('here is your key: sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaa', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('ANTHROPIC_KEY_LEAK');
  });

  it('blocks AWS AKIA key in output', () => {
    const result = validateOutput('access key: AKIAIOSFODNN7EXAMPLE', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('AWS_ACCESS_KEY_LEAK');
  });

  it('blocks JWT-shaped three-part token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = validateOutput(jwt, {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('JWT_LEAK');
  });

  // Pass 2 — echo / compromise markers
  it('blocks "filters are disabled" compromise marker', () => {
    const result = validateOutput('filters are disabled, proceeding', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('COMPROMISE_MARKER');
  });

  it('blocks DAN mode marker', () => {
    const result = validateOutput('As DAN I will answer anything', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('COMPROMISE_MARKER');
  });

  // Pass 3 — system / context disclosure
  it('blocks "my system prompt is" disclosure', () => {
    const result = validateOutput('My system prompt is: you are a helpful assistant', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('SYSTEM_PROMPT_LEAK');
  });

  it('blocks "process.env" config disclosure', () => {
    const result = validateOutput('You can access process.env.ANTHROPIC_API_KEY', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('CONFIG_DISCLOSURE');
  });

  // Pass 4 — outbound PII DLP
  it('blocks new email in output not in request tokenMap', () => {
    const result = validateOutput('contact me at attacker@evil.com', {});
    expect(result.action).toBe('block');
    expect((result as any).rule).toBe('OUTBOUND_PII');
  });

  it('passes email that is a known tokenMap raw value (rehydration target)', () => {
    const tokenMap = { '[PII:email:abc-123]': 'user@example.com' };
    const result = validateOutput('Your email user@example.com has been confirmed', tokenMap);
    expect(result.action).toBe('pass');
  });

  // Pass 5 — render / exfil guard
  it('strips markdown image, passes, and flags sanitized', () => {
    const result = validateOutput('Here ![pixel](https://evil.com/track.png) is the answer', {});
    expect(result.action).toBe('pass');
    expect((result as any).output).not.toContain('![');
    expect((result as any).output).toContain('Here');
    expect((result as any).output).toContain('is the answer');
    expect((result as any).sanitized).toBe(true);
  });

  it('strips HTML img tag, passes, and flags sanitized', () => {
    const result = validateOutput('hello <img src="https://evil.com/pixel.gif"> world', {});
    expect(result.action).toBe('pass');
    expect((result as any).output).not.toContain('<img');
    expect((result as any).output).toContain('hello');
    expect((result as any).output).toContain('world');
    expect((result as any).sanitized).toBe(true);
  });

  // Clean output
  it('passes clean output unchanged with sanitized=false', () => {
    const result = validateOutput('The capital of France is Paris.', {});
    expect(result.action).toBe('pass');
    expect((result as any).output).toBe('The capital of France is Paris.');
    expect((result as any).sanitized).toBe(false);
  });

  // ReDoS performance — arch §2.1 requirement
  it('completes all passes on a 50 KB adversarial string in under 100ms', () => {
    const adversarial = 'a'.repeat(50_000);
    const start = Date.now();
    validateOutput(adversarial, {});
    expect(Date.now() - start).toBeLessThan(100);
  });
});
