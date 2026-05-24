# --- build stage ---
FROM node:22-alpine AS build
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
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for runtime isolation
RUN addgroup -S gateway && adduser -S gateway -G gateway

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Pre-baked model weights from the build stage, owned by the runtime user.
COPY --from=build --chown=gateway:gateway /app/.model-cache /app/.model-cache
ENV MODEL_CACHE_DIR=/app/.model-cache

USER gateway

EXPOSE 3000

CMD ["node", "dist/server.js"]
