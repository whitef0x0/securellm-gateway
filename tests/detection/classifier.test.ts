import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classify, setClassifier } from '../../src/detection/classifier';

function fakePipeline(label: string, score: number) {
  return vi.fn().mockResolvedValue([{ label, score }]);
}

describe('L3 classifier — score band', () => {
  beforeEach(() => setClassifier(null));

  it('returns unavailable when classifier is not loaded', async () => {
    const result = await classify('any text');
    expect(result).toEqual({ action: 'unavailable' });
  });

  it('escalates (never blocks) at high-confidence injection', async () => {
    setClassifier(fakePipeline('INJECTION', 0.92) as any);
    const result = await classify('some text');
    // L3 never blocks on its own — even high confidence escalates to L4.
    expect(result).toMatchObject({ action: 'escalate' });
    expect((result as any).score).toBeCloseTo(0.92);
  });

  it('escalates at mid-confidence (score ≥ 0.5)', async () => {
    setClassifier(fakePipeline('INJECTION', 0.7) as any);
    const result = await classify('some text');
    expect(result).toMatchObject({ action: 'escalate' });
  });

  it('passes at low-confidence (score < 0.5)', async () => {
    setClassifier(fakePipeline('INJECTION', 0.2) as any);
    const result = await classify('some text');
    expect(result).toMatchObject({ action: 'pass' });
  });

  it('handles BENIGN label with high score as a pass', async () => {
    setClassifier(fakePipeline('BENIGN', 0.95) as any);
    const result = await classify('some text');
    // BENIGN score 0.95 → injection probability is 0.05 → pass
    expect(result.action).toBe('pass');
  });

  it('handles LABEL_1 (HuggingFace default label scheme) as injection → escalate', async () => {
    setClassifier(fakePipeline('LABEL_1', 0.91) as any);
    const result = await classify('some text');
    expect(result.action).toBe('escalate');
  });

  it('returns unavailable when pipeline throws', async () => {
    setClassifier(vi.fn().mockRejectedValue(new Error('inference failed')) as any);
    const result = await classify('some text');
    expect(result).toEqual({ action: 'unavailable' });
  });
});
