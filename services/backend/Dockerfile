# syntax=docker/dockerfile:1
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

WORKDIR /app/services/backend
EXPOSE 3001
CMD ["node", "dist/server.js"]
