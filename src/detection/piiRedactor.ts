import { randomUUID } from 'node:crypto';

export type TokenMap = Record<string, string>;

export interface RedactionResult {
  text: string;
  tokenMap: TokenMap;
}

// Israeli Teudat Zehut checksum (Luhn variant)
function isValidIsraeliId(digits: string): boolean {
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(digits[i]!, 10) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Israeli local mobile: 05X-XXXXXXX or 05XXXXXXXX (with optional separators)
// Israeli +972: +972-5X-XXX-XXXX variants
// International: +[1-9] followed by 6-14 digits with optional separators (hyphens/spaces/dots)
const PHONE_RE =
  /(?:\+972[\s-]?(?:5[0-9])[\s-]?\d{3}[\s-]?\d{4}|\+[1-9](?:[\s.-]?\d){6,14}|0(?:5[0-9])[\s-]?\d{3,4}[\s-]?\d{4})/g;

// Context cues that flag nearby 9-digit numbers as Israeli IDs
const ID_CONTEXT_CUES = /(?:ת\.ז|תעודת\s+זהות|national\s+id|id[_\s]?number|id\s*:)/i;

// Math context guard: don't redact if preceded/followed by operator or decimal
const MATH_ADJACENT = /[\d.+\-*/=]\s*$/;
// '.' only counts as math when immediately followed by a digit (decimal point, not sentence period)
const MATH_FOLLOWING = /^\s*(?:[\d+\-*/=]|\.\d)/;

function redactIsraeliIds(text: string, tokenMap: TokenMap): string {
  return text.replace(/\b(\d{9})\b/g, (match, digits, offset) => {
    const before = text.slice(0, offset);
    const after = text.slice(offset + match.length);

    if (MATH_ADJACENT.test(before) || MATH_FOLLOWING.test(after)) return match;

    const hasCue = ID_CONTEXT_CUES.test(before.slice(-40));
    if (!hasCue && !isValidIsraeliId(digits)) return match;

    const token = `[PII:israeli_id:${randomUUID()}]`;
    tokenMap[token] = match;
    return token;
  });
}

function replaceWithToken(
  text: string,
  regex: RegExp,
  type: 'email' | 'phone',
  tokenMap: TokenMap,
): string {
  return text.replace(regex, (match) => {
    const token = `[PII:${type}:${randomUUID()}]`;
    tokenMap[token] = match;
    return token;
  });
}

export function redactPii(input: string): RedactionResult {
  const tokenMap: TokenMap = {};
  let text = input;
  // Order matters: email first, then phone, then Israeli ID (per arch §10.4)
  text = replaceWithToken(text, EMAIL_RE, 'email', tokenMap);
  text = replaceWithToken(text, PHONE_RE, 'phone', tokenMap);
  text = redactIsraeliIds(text, tokenMap);
  return { text, tokenMap };
}

export function rehydratePii(text: string, tokenMap: TokenMap): string {
  return text.replace(/\[PII:(?:email|phone|israeli_id):[0-9a-f-]{36}\]/g, (token) => {
    // Only replace tokens present in THIS request's map — forgery resistance
    return tokenMap[token] ?? token;
  });
}
