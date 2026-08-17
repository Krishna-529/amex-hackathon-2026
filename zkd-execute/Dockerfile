# Build context is the repo root (see ../docker-compose.yml and
# infra/execution-plane/execute.tf) — zkd-execute depends on ../zkd-shared
# via a `file:` reference, so zkd-shared has to be inside the build context.
FROM node:22-slim AS base
WORKDIR /build

COPY zkd-shared ./zkd-shared
COPY zkd-execute ./zkd-execute

WORKDIR /build/zkd-execute
RUN npm install --omit=dev

WORKDIR /build/zkd-shared
RUN npm install --omit=dev

WORKDIR /build/zkd-execute
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/worker.ts"]
