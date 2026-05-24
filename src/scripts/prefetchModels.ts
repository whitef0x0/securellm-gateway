// Run at Docker build time to pre-cache the L3 classifier ONNX weights into the
// image so the first `docker compose up` works offline and starts in <5s instead
// of waiting on a ~140 MB HuggingFace download. Re-run when the L3 model changes.
//
// Reads L3_CLASSIFIER_MODEL from env (defaults to the same value as
// src/config/index.ts). Cache goes to the default transformers.js location;
// the runtime stage COPYs that cache dir.

const modelId = process.env.L3_CLASSIFIER_MODEL ?? 'protectai/deberta-v3-base-prompt-injection-v2';

async function main(): Promise<void> {
  const { pipeline, env } = await import('@huggingface/transformers');
  // Must match loadClassifier()'s cache dir so the runtime finds the pre-baked weights.
  env.cacheDir = process.env.MODEL_CACHE_DIR ?? `${process.cwd()}/.model-cache`;
  console.log(`prefetching L3 classifier: ${modelId} → ${env.cacheDir}`);
  await pipeline('text-classification', modelId);
  console.log(`prefetched ${modelId}`);
}

main().catch((err) => {
  console.error('prefetch failed:', err);
  process.exit(1);
});
