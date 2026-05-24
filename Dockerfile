# --- build stage ---
# Debian-based (glibc), NOT alpine: onnxruntime-node (pulled in by
# @huggingface/transformers for the L3 classifier) ships prebuilt binaries that
# link against glibc. Alpine's musl libc cannot load them (ld-linux-*.so.1 missing).
FROM node:22-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Pre-cache the L3 classifier (DeBERTa-v3-base-prompt-injection-v2 ONNX weights)
# into a stable path so the first `docker compose up` runs offline and doesn't
# wait on a ~440 MB HuggingFace download. The runtime stage COPYs this directory.
ENV MODEL_CACHE_DIR=/app/.model-cache
RUN npx tsx src/scripts/prefetchModels.ts

# --- runtime stage ---
FROM node:22-slim AS runtime
WORKDIR /app

# Non-root user for runtime isolation
RUN groupadd --system gateway && useradd --system --gid gateway gateway

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Pre-baked model weights from the build stage, owned by the runtime user.
COPY --from=build --chown=gateway:gateway /app/.model-cache /app/.model-cache
ENV MODEL_CACHE_DIR=/app/.model-cache

USER gateway

EXPOSE 3000

CMD ["node", "dist/server.js"]
