# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for runtime isolation
RUN addgroup -S gateway && adduser -S gateway -G gateway

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

USER gateway

EXPOSE 3000

CMD ["node", "dist/server.js"]
