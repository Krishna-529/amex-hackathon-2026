# Build context is the repo root (see ../docker-compose.yml and
# zkd-risk-model/infra/app.tf) — zkd-app depends on ../zkd-shared via a
# `file:` reference and consumes it as TS source (next.config.mjs's
# transpilePackages), so zkd-shared has to be inside the build context and
# present at runtime, not just at build time.
FROM node:22-slim AS base
WORKDIR /build

COPY zkd-shared ./zkd-shared
COPY zkd-app ./zkd-app

WORKDIR /build/zkd-app
RUN npm install

# next build always runs as a production build regardless of NODE_ENV at
# this point, which trips server/auth/session.ts's "refuse to sign sessions
# with the checked-in dev secret in production" guard during page-data
# collection — a build-time-only placeholder satisfies that; the REAL
# runtime value must come from `docker run`/compose `environment:` or (in
# AWS) Secrets Manager, which overrides this image default at container
# start, never baked in as the real value.
ARG SESSION_SECRET=build-time-placeholder-not-for-runtime-use
ENV SESSION_SECRET=$SESSION_SECRET
# DATABASE_URL unreachable at build time degrades gracefully (server/domain/
# seed.ts's ensureSeeded() catches and logs) — no build-time DB is required.
RUN npm run build

ENV NODE_ENV=production
# Matches package.json's start script (`next start -p 5176`, hardcoded —
# this app's established local port, see README), not the generic 3000.
EXPOSE 5176
CMD ["npm", "start"]
