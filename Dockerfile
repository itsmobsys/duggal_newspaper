# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Duggal Badmosh Daily - newsroom API (Fastify + Turso + Vercel Blob + MiniMax)
#
# Built for Render's free tier: one small Node process that serves the API,
# runs the queue worker, and reads/writes Turso. The website stays on Vercel;
# this image is only the backend.
#
# Why a multi-stage build:
#   - `build` installs dev dependencies (tsup/typescript), compiles the server
#     to `dist/`, then prunes back to production dependencies;
#   - `runtime` copies only `dist/`, `node_modules/`, `package.json` and the SQL
#     migrations. No source, no tests, no build tooling, no secrets.
#
# Security posture:
#   - runs as the unprivileged `node` user (uid 1000), never root;
#   - no secrets are baked in: every credential arrives as a Render env var;
#   - `NODE_OPTIONS` caps the V8 heap so a 512 MB free instance is not OOM
#     killed (override it in Render if you upgrade the plan).
#
# The API reads PORT and HOST from the environment and binds to 0.0.0.0 by
# default, which is what Render expects. Health check: GET /healthz.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22

# --------------------------------------------------------------- build stage
FROM node:${NODE_VERSION}-bookworm-slim AS build

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# Keep the monorepo shape so `tsconfig.json` can extend `../../tsconfig.base.json`.
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/

WORKDIR /app/apps/api
RUN npm ci

COPY apps/api/tsconfig.json apps/api/tsup.config.ts ./
COPY apps/api/src ./src

# Compile (tsup bundles everything except sharp, @libsql/client and
# @vercel/blob), then drop dev dependencies from the same tree.
RUN npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

# ------------------------------------------------------------- runtime stage
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Duggal Badmosh Daily API" \
      org.opencontainers.image.description="Autonomous newspaper backend: submissions, AI pipeline, queue worker, admin API" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/itsmobsys/duggal_newspaper"

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=8080 \
    MIGRATIONS_DIR=/app/db/migrations \
    NODE_OPTIONS=--max-old-space-size=320

WORKDIR /app

# Runtime artefacts only. `--chown` keeps everything readable by `node`.
COPY --from=build --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
COPY --chown=node:node db/migrations ./db/migrations

# Never run the internet-facing process as root.
USER node

EXPOSE 8080

# Liveness only: /healthz is 200 whenever the process is up. Render has its own
# health check, this one makes plain `docker run` behave sensibly too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form: node is PID 1 and receives SIGTERM directly, so the graceful
# shutdown in src/server.ts (close server -> close database) actually runs.
CMD ["node", "dist/server.js"]
