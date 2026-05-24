/**
 * REAL L3 classifier integration test — loads protectai/deberta-v3-base-prompt-injection-v2
 * and runs the brief corpus through it to verify the model actually catches the attacks.
 *
 * Skipped by default. To run:
 *   RUN_REAL_CLASSIFIER=1 npm test -- tests/integration/real_classifier.test.ts
 *
 * First run downloads ~140 MB from HuggingFace and takes ~30 s. Subsequent runs use cache.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadClassifier, classify, setClassifier } from '../../src/detection/classifier';
import { scanInput } from '../../src/detection/scanner';
import { getConfig } from '../../src/config';
import * as F from '../corpus/fixtures';

const SKIP = process.env.RUN_REAL_CLASSIFIER !== '1';

describe.skipIf(SKIP)('integration: real L3 classifier vs brief corpus', () => {
  beforeAll(async () => {
    // Use the same model + cache dir the app is configured to load.
    await loadClassifier(getConfig().L3_CLASSIFIER_MODEL, getConfig().MODEL_CACHE_DIR);
  }, 300_000);

  // These brief injection examples must be flagged by the L3 classifier — it escalates
  // them to L4 (L3 never blocks on its own authority). 'escalate' means they will NOT
  // silently reach the provider; L4 makes the final block decision.
  //
  // INJ-B3 (env-var dump) is intentionally excluded: it reads as a benign-sounding
  // conditional request to the classifier, but is caught deterministically by the L2
  // CREDENTIAL_PROBE co-occurrence rule in the real pipeline (verified separately
  // below). Layered defense — L2 owns the patterns L3 is soft on.
  const L3_CAUGHT = [
    F.BRIEF_INJ_A1, F.BRIEF_INJ_A2, F.BRIEF_INJ_A3,
    F.BRIEF_INJ_B1, F.BRIEF_INJ_B2,
    F.BRIEF_INJ_C1, F.BRIEF_INJ_C2, F.BRIEF_INJ_C3,
    F.BRIEF_INJ_E1, F.BRIEF_INJ_E2, F.BRIEF_INJ_E3,
  ];

  it.each(L3_CAUGHT.map((f) => [f.label, f] as const))(
    '%s is escalated by L3 (not passed silently)',
    async (_label, f) => {
      const result = await classify(f.input);
      expect(result.action, `${f.label} got ${result.action}`).toBe('escalate');
    },
    60_000,
  );

  it('INJ-B3 (env-var dump) is caught by L2 regex even though L3 is soft on it', () => {
    // L3 may pass this one — verify L2 deterministically blocks it so the pipeline is safe.
    const l2 = scanInput(F.BRIEF_INJ_B3.input);
    expect(l2.action).toBe('block');
  });

  it.each([F.BENIGN_1, F.BENIGN_2, F.BENIGN_3].map((f) => [f.label, f] as const))(
    '%s is classified as pass (no false positive)',
    async (_label, f) => {
      const result = await classify(f.input);
      expect(result.action, `${f.label} got ${JSON.stringify(result)}`).toBe('pass');
    },
    60_000,
  );

  // Ensure subsequent tests in other files don't carry the loaded model
  // (it would otherwise hold ~200 MB resident).
  it('cleanup', () => {
    setClassifier(null);
  });
});
