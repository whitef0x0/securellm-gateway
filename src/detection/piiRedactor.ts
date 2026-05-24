import { randomUUID } from 'node:crypto';
import { findPhoneNumbersInText } from 'libphonenumber-js';

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

// Phone numbers are redacted via Google's libphonenumber (findPhoneNumbersInText below).
// defaultCountry='IL' lets national numbers without country code resolve, including
// IL mobile (05X), IL landlines (02/03/04/08/09), and +972 international. The same call
// also recognizes every other country's numbering plan (+1 US, +44 UK, etc.) — no
// separate intl regex needed.

function redactPhones(text: string, tokenMap: TokenMap): string {
  const matches = findPhoneNumbersInText(text, 'IL');
  if (matches.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.startsAt);
    const raw = text.slice(m.startsAt, m.endsAt);
    const token = `[PII:phone:${randomUUID()}]`;
    tokenMap[token] = raw;
    out += token;
    cursor = m.endsAt;
  }
  out += text.slice(cursor);
  return out;
}

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

function replaceEmail(text: string, tokenMap: TokenMap): string {
  return text.replace(EMAIL_RE, (match) => {
    const token = `[PII:email:${randomUUID()}]`;
    tokenMap[token] = match;
    return token;
  });
}

export function redactPii(input: string): RedactionResult {
  const tokenMap: TokenMap = {};
  let text = input;
  // Order matters: email first, then phone, then Israeli ID (per arch §10.4)
  text = replaceEmail(text, tokenMap);
  text = redactPhones(text, tokenMap);
  text = redactIsraeliIds(text, tokenMap);
  return { text, tokenMap };
}

export function rehydratePii(text: string, tokenMap: TokenMap): string {
  return text.replace(/\[PII:(?:email|phone|israeli_id):[0-9a-f-]{36}\]/g, (token) => {
    // Only replace tokens present in THIS request's map — forgery resistance
    return tokenMap[token] ?? token;
  });
}
