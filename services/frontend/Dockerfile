# syntax=docker/dockerfile:1
#
# Build context is the repository root (see docker-compose.yml:
# `frontend.build.context: .`, `frontend.build.dockerfile:
# services/frontend/Dockerfile`) — `npm ci` needs the root
# lockfile/workspace manifest to resolve @trellis/frontend's dependencies.

# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app

# Manifests only, first: `npm ci` is cached independently of source changes.
COPY package.json package-lock.json ./
COPY services/frontend/package.json services/frontend/package.json
RUN npm ci

# services/frontend/tsconfig.json extends the repo-root base config — without
# it here, `tsc -b` fails with TS5083 (cannot read tsconfig.base.json), same
# defect as services/backend/Dockerfile (see task-005 report).
COPY tsconfig.base.json ./
COPY services/frontend services/frontend
RUN npm run build -w @trellis/frontend

# ---- runtime ----
# nginx:alpine, not node — this stage only ever serves static files, and it
# ships busybox wget, which docker-compose.yml's healthcheck for this
# service depends on (task-002 report).
FROM nginx:alpine AS runtime

COPY --from=builder /app/services/frontend/dist /usr/share/nginx/html
COPY services/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
