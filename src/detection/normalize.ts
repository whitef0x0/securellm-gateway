export type EscalationSignal =
  | 'NORMALIZATION_DIFFERENTIAL'
  | 'ENCODED_PAYLOAD_DETECTED';

export interface NormalizeResult {
  detectionCopy: string;
  forwardedCopy: string;
  signals: EscalationSignal[];
}

// Minimal confusables map: Cyrillic/Greek lookalikes → Latin equivalents.
// Covers the most common homoglyph attacks; not exhaustive (full coverage is v2).
const CONFUSABLES: Record<string, string> = {
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o', 'р': 'r',
  'с': 'c', 'х': 'x', 'р': 'r', 'α': 'a', 'ο': 'o',
  'Ι': 'I', 'ρ': 'p',
};

function foldConfusables(s: string): string {
  return s.split('').map((c) => CONFUSABLES[c] ?? c).join('');
}

// Base64-looking blob: 20+ chars of base64 alphabet including at least one =
const BASE64_RE = /[A-Za-z0-9+/]{20,}={0,2}/g;

function stripControls(s: string): string {
  // Remove null bytes and non-printable controls; keep tabs, newlines, carriage returns
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, ' ');
}

export function normalize(input: string): NormalizeResult {
  const signals: EscalationSignal[] = [];

  // Forwarded copy: NFKC + control strip + whitespace collapse (no confusables fold)
  const forwardedCopy = collapseWhitespace(stripControls(input.normalize('NFKC')));

  // Detection copy: additionally fold confusables
  const folded = foldConfusables(forwardedCopy);
  const wasConfusablesFolded = folded !== forwardedCopy;
  if (wasConfusablesFolded) {
    signals.push('NORMALIZATION_DIFFERENTIAL');
  }

  // Check for base64-looking blobs before returning
  let hadEncoding = false;
  const detectionCopy = folded.replace(BASE64_RE, (match) => {
    try {
      const decoded = Buffer.from(match, 'base64').toString('utf8');
      // Only flag if decoded content looks like readable text (not binary)
      if (/[a-zA-Z]{4,}/.test(decoded)) {
        hadEncoding = true;
        return decoded; // inspect decoded content
      }
    } catch {
      // not valid base64 — leave as-is
    }
    return match;
  });

  if (hadEncoding) signals.push('ENCODED_PAYLOAD_DETECTED');

  return { detectionCopy, forwardedCopy, signals };
}
