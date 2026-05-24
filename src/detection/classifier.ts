// L3: local ML classifier for prompt injection.
// Default model: protectai/deberta-v3-base-prompt-injection-v2 (ungated on HF, ~139 M params).
// Loaded once at server startup via @huggingface/transformers; runs CPU-only.
// If the model fails to load, classify() returns `unavailable` and the pipeline falls back
// to the existing L2 → L4 path (fail-open semantics for the classifier; injection detection
// is never silently disabled — L4 still runs as backstop).
import { logger } from '../logger';

// L3 never blocks on its own authority. A 139M local classifier is a high-recall
// *trigger*, not the final arbiter — it false-positives on structured payloads (e.g.
// a benign "summarise this customer JSON" request scores >0.99 injection). So any
// suspicious score escalates to the more capable L4 judge, which makes the block/pass
// decision. Below threshold → pass (no L4 cost on clearly-benign traffic).
export type ClassifierVerdict =
  | { action: 'escalate'; score: number }
  | { action: 'pass'; score: number }
  | { action: 'unavailable' };

// The HuggingFace pipeline is a callable function. We type it minimally to avoid
// pulling complex types from @huggingface/transformers across the codebase.
type ClassifierPipeline = (text: string) => Promise<unknown>;

// Above this injection probability, escalate to the L4 judge. Tuned for recall:
// false positives are cheap (an extra judge call), false negatives are a breach.
const ESCALATE_THRESHOLD = 0.5;

let pipeline: ClassifierPipeline | null = null;

export function getClassifier(): ClassifierPipeline | null {
  return pipeline;
}

export function setClassifier(p: ClassifierPipeline | null): void {
  pipeline = p;
}

export async function loadClassifier(modelId: string, cacheDir: string): Promise<void> {
  try {
    const transformers = await import('@huggingface/transformers');
    const { pipeline: createPipeline, env } = transformers;
    // Persist model weights outside node_modules so they survive `npm ci` and aren't
    // re-downloaded every run. In Docker this points at the pre-baked image path.
    env.cacheDir = cacheDir;
    pipeline = (await createPipeline('text-classification', modelId)) as unknown as ClassifierPipeline;
  } catch (err) {
    // Model load failure is non-fatal: classify() will return 'unavailable' and the
    // pipeline falls back to L4. Log it so the failure is diagnosable in production.
    logger.warn({ err, modelId }, 'L3 classifier failed to load — falling back to L4');
    pipeline = null;
  }
}

export async function classify(text: string): Promise<ClassifierVerdict> {
  if (!pipeline) return { action: 'unavailable' };
  try {
    const raw = (await pipeline(text)) as unknown;
    const arr = Array.isArray(raw) ? raw : [raw];
    const result = arr[0] as { label: string; score: number };
    // Most prompt-injection classifiers emit either "INJECTION"/"BENIGN" or "LABEL_1"/"LABEL_0"
    const isInjection = /injection|jailbreak|label_1/i.test(result.label);
    const score = isInjection ? result.score : 1 - result.score;
    if (score >= ESCALATE_THRESHOLD) return { action: 'escalate', score };
    return { action: 'pass', score };
  } catch {
    return { action: 'unavailable' };
  }
}
