# Директивы `# syntax=docker/dockerfile:1` здесь намеренно НЕТ.
#
# Она заставляет BuildKit на каждой сборке ходить в Docker Hub за образом
# frontend'а (тег `:1` подвижный, поэтому он перепроверяется), и на
# нестабильной сети сборка падает с «failed to resolve source metadata for
# docker.io/docker/dockerfile:1» ещё до того, как прочитан хоть один слой.
# За сессию это уронило сквозной тест трижды. Ничего из того, что требует
# внешнего frontend'а (RUN --mount, heredoc'и, COPY --parents/--link),
# здесь не используется — встроенного в BuildKit достаточно, а у локального
# приложения на одну зависимость от внешнего сервиса меньше.
#
# Build context is the repository root (see docker-compose.yml:
# `backend.build.context: .`, `backend.build.dockerfile:
# services/backend/Dockerfile`) — `npm ci` needs the root lockfile/workspace
# manifest to resolve @trellis/backend's dependencies.

# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app

# Manifests only, first: `npm ci` is cached independently of source changes.
COPY package.json package-lock.json ./
COPY services/backend/package.json services/backend/package.json
RUN npm ci

# services/backend/tsconfig.json extends the repo-root base config — without
# it here, `tsc` fails with TS5083 (cannot read tsconfig.base.json).
COPY tsconfig.base.json ./
COPY services/backend services/backend
RUN npm run build -w @trellis/backend

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY services/backend/package.json services/backend/package.json
RUN npm ci --omit=dev

COPY --from=builder /app/services/backend/dist services/backend/dist
# runMigrations() resolves its default migrations dir at runtime as
# ../../migrations relative to the compiled migrate.js (dist/db/migrate.js),
# i.e. services/backend/migrations next to dist/ — must be copied alongside
# dist or migrations at startup fail with ENOENT (see task-005 report).
COPY --from=builder /app/services/backend/migrations services/backend/migrations

# node:22-alpine ships a non-root `node` user (uid 1000) precisely for this —
# running the app as root in the runtime image is an unnecessary privilege
# escalation with no upside (see final-review fixes report, minor items).
USER node

WORKDIR /app/services/backend
EXPOSE 3001
CMD ["node", "dist/server/server.js"]
