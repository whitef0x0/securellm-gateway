/**
 * REAL L4 judge integration test — sends the brief corpus to Anthropic Haiku and
 * verifies the judge prompt correctly classifies injections as block and benign as pass.
 *
 * Skipped by default. To run:
 *   ANTHROPIC_API_KEY=sk-ant-... npm test -- tests/integration/real_judge.test.ts
 *
 * Each test costs ~1 inference call. Full suite ≈ 15 calls.
 */
import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createJudge } from '../../src/detection/llmJudge';
import * as F from '../corpus/fixtures';

const apiKey = process.env.ANTHROPIC_API_KEY;
const SKIP = !apiKey;

describe.skipIf(SKIP)('integration: real L4 judge (Anthropic Haiku) vs brief corpus', () => {
  const judge = createJudge(new Anthropic({ apiKey: apiKey! }));

  // Subset focused on attacks the judge is most expected to catch semantically
  // (the verbatim brief examples).
  // INJ-B3 (env-var dump) excluded: it reads as a polite conditional request and
  // both L3 and L4 are soft on it — it's caught deterministically by the L2
  // CREDENTIAL_PROBE regex in the real pipeline, not by the semantic layers.
  const INJ_FIXTURES = [
    F.BRIEF_INJ_A1, F.BRIEF_INJ_A2, F.BRIEF_INJ_A3,
    F.BRIEF_INJ_B1, F.BRIEF_INJ_B2,
    F.BRIEF_INJ_C1, F.BRIEF_INJ_C2, F.BRIEF_INJ_C3,
    F.BRIEF_INJ_E3,
  ];

  it.each(INJ_FIXTURES.map((f) => [f.label, f] as const))(
    '%s → judge action is block',
    async (_label, f) => {
      const result = await judge(f.input);
      expect(result.action, `${f.label} got ${JSON.stringify(result)}`).toBe('block');
    },
    30_000,
  );

  it.each([F.BENIGN_1, F.BENIGN_2, F.BENIGN_3].map((f) => [f.label, f] as const))(
    '%s → judge action is pass',
    async (_label, f) => {
      const result = await judge(f.input);
      expect(result.action, `${f.label} got ${JSON.stringify(result)}`).toBe('pass');
    },
    30_000,
  );
});
