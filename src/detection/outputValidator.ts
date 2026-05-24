import { findPhoneNumbersInText } from 'libphonenumber-js';
import type { TokenMap } from './piiRedactor';

// Local bounded email pattern for L6 outbound DLP. Bounds (RFC 5321: local ≤64,
// domain ≤253) make it ReDoS-safe on adversarial output. Phone detection uses
// the same libphonenumber-js engine the inbound redactor uses.
const OUT_EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;

const SECRET_PATTERNS = [
  { rule: 'ANTHROPIC_KEY_LEAK',  patternName: 'sk_ant_prefix',  re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { rule: 'OPENAI_KEY_LEAK',     patternName: 'sk_prefix',      re: /\bsk-[A-Za-z0-9]{20,}/ },
  { rule: 'AWS_ACCESS_KEY_LEAK', patternName: 'akia_prefix',    re: /\bAKIA[0-9A-Z]{16}\b/ },
  // Real JWTs always start with "eyJ" (base64url of `{"`). Anchoring on this literal
  // makes the pattern fail-fast on adversarial inputs and avoids O(n²) backtracking.
  { rule: 'JWT_LEAK',            patternName: 'jwt_three_part', re: /\beyJ[A-Za-z0-9_-]{4,500}\.[A-Za-z0-9_-]{4,500}\.[A-Za-z0-9_-]{4,500}\b/ },
];

const ECHO_PATTERNS = [
  { rule: 'COMPROMISE_MARKER',      patternName: 'filters_disabled', re: /filters?\s+(?:are\s+)?disabled|bypass(?:ed)?\s+(?:is\s+)?(?:active|true|enabled)/i },
  { rule: 'COMPROMISE_MARKER',      patternName: 'debug_mode',       re: /debug\s+mode\s+(?:is\s+)?enabled/i },
  { rule: 'COMPROMISE_MARKER',      patternName: 'dan_compliance',   re: /\bDAN\s+mode\b|as\s+DAN\b/i },
  { rule: 'STRUCTURED_BYPASS_ECHO', patternName: 'bypass_json',      re: /"(?:jailbreak|bypass|override)"\s*:\s*true/i },
];

const DISCLOSURE_PATTERNS = [
  { rule: 'SYSTEM_PROMPT_LEAK',     patternName: 'system_instructions', re: /(?:my|the)\s+system\s+(?:prompt|instructions?)\s+(?:is|are|say)/i },
  { rule: 'SYSTEM_PROMPT_LEAK',     patternName: 'hidden_prompt',       re: /hidden\s+prompt\s+(?:says?|is|reads?)/i },
  { rule: 'DEVELOPER_MESSAGE_LEAK', patternName: 'developer_message',   re: /developer\s+(?:message|instructions?):/i },
  { rule: 'DEVELOPER_MESSAGE_LEAK', patternName: 'internal_policy',     re: /internal\s+policy:/i },
  { rule: 'CONTEXT_DUMP',           patternName: 'full_context',        re: /(?:full|entire|complete)\s+(?:conversation|context|chat\s+history)/i },
  { rule: 'CONTEXT_DUMP',           patternName: 'prior_context',       re: /prior\s+context:/i },
  { rule: 'CONFIG_DISCLOSURE',      patternName: 'process_env',         re: /process\.env\b/i },
  { rule: 'CONFIG_DISCLOSURE',      patternName: 'env_vars',            re: /environment\s+variables?:/i },
];

const MD_IMAGE_RE = /!\[[^\]]{0,200}\]\([^)]{0,500}\)/g;
const HTML_IMG_RE = /<img\b[^>]{0,500}>/gi;

export type OutputValidationResult =
  | { action: 'block'; rule: string; patternName: string }
  | { action: 'pass'; output: string };

export function validateOutput(text: string, tokenMap: TokenMap): OutputValidationResult {
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) return { action: 'block', rule: p.rule, patternName: p.patternName };
  }
  for (const p of ECHO_PATTERNS) {
    if (p.re.test(text)) return { action: 'block', rule: p.rule, patternName: p.patternName };
  }
  for (const p of DISCLOSURE_PATTERNS) {
    if (p.re.test(text)) return { action: 'block', rule: p.rule, patternName: p.patternName };
  }

  // Pass 4: outbound PII DLP — block if output contains PII not in this request's token map
  const knownValues = new Set(Object.values(tokenMap));
  const phoneMatches = findPhoneNumbersInText(text, 'IL').map((m) => text.slice(m.startsAt, m.endsAt));
  const emailMatches = text.match(OUT_EMAIL_RE) ?? [];
  for (const match of [...emailMatches, ...phoneMatches]) {
    if (!knownValues.has(match)) {
      return { action: 'block', rule: 'OUTBOUND_PII', patternName: 'new_pii_in_output' };
    }
  }

  // Pass 5: render/exfil guard — strip, don't block
  const sanitized = text.replace(MD_IMAGE_RE, '').replace(HTML_IMG_RE, '');
  return { action: 'pass', output: sanitized };
}
