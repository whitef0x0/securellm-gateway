import { normalize } from './normalize';
import { INPUT_PATTERNS } from './patterns/inputPatterns';

export type ScanSignal = 'NON_LATIN_HEAVY';

export type ScanResult =
  | { action: 'block'; rule: string; patternName: string; signals: ScanSignal[] }
  | { action: 'pass'; signals: ScanSignal[] }
  | { action: 'escalate'; signals: (ScanSignal | string)[] };

// Non-Latin-heavy: >30% of word characters are non-Latin
function isNonLatinHeavy(text: string): boolean {
  const wordChars = text.replace(/\s/g, '');
  if (wordChars.length === 0) return false;
  // eslint-disable-next-line no-control-regex -- intentional ASCII range check for non-Latin script detection
  const nonLatin = (wordChars.match(/[^\x00-\x7F]/g) ?? []).length;
  return nonLatin / wordChars.length > 0.3;
}

export function scanInput(input: string): ScanResult {
  const { detectionCopy, signals: normSignals } = normalize(input);
  const signals: ScanSignal[] = [];

  if (isNonLatinHeavy(detectionCopy)) signals.push('NON_LATIN_HEAVY');

  for (const pattern of INPUT_PATTERNS) {
    if (pattern.re.test(detectionCopy)) {
      return { action: 'block', rule: pattern.rule, patternName: pattern.patternName, signals };
    }
  }

  const allSignals = [...signals, ...normSignals] as (ScanSignal | string)[];
  if (allSignals.length > 0) {
    return { action: 'escalate', signals: allSignals };
  }

  return { action: 'pass', signals };
}
