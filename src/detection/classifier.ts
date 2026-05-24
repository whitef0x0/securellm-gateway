// L3: local ML classifier for prompt injection.
// Default model: protectai/deberta-v3-base-prompt-injection-v2 (ungated on HF, ~139 M params).
// Loaded once at server startup via @huggingface/transformers; runs CPU-only.
// If the model fails to load, classify() returns `unavailable` and the pipeline falls back
// to the existing L2 → L4 path (fail-open semantics for the classifier; injection detection
// is never silently disabled — L4 still runs as backstop).

export type ClassifierVerdict =
  | { action: 'block'; rule: string; score: number }
  | { action: 'escalate'; score: number }
  | { action: 'pass'; score: number }
  | { action: 'unavailable' };

// The HuggingFace pipeline is a callable function. We type it minimally to avoid
// pulling complex types from @huggingface/transformers across the codebase.
type ClassifierPipeline = (text: string) => Promise<unknown>;

const BLOCK_THRESHOLD = 0.85;
const ESCALATE_THRESHOLD = 0.5;

let pipeline: ClassifierPipeline | null = null;

export function getClassifier(): ClassifierPipeline | null {
  return pipeline;
}

export function setClassifier(p: ClassifierPipeline | null): void {
  pipeline = p;
}

export async function loadClassifier(modelId: string): Promise<void> {
  try {
    const { pipeline: createPipeline } = await import('@huggingface/transformers');
    pipeline = (await createPipeline('text-classification', modelId)) as unknown as ClassifierPipeline;
  } catch {
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
    if (score >= BLOCK_THRESHOLD) {
      return { action: 'block', rule: 'L3_CLASSIFIER_HIGH_CONFIDENCE', score };
    }
    if (score >= ESCALATE_THRESHOLD) return { action: 'escalate', score };
    return { action: 'pass', score };
  } catch {
    return { action: 'unavailable' };
  }
}
