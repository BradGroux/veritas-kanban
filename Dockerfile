# =============================================================================
# Veritas Kanban — Production Multi-Stage Dockerfile
# =============================================================================
# Stages:
#   1. deps        — Install all workspace dependencies (shared cache layer)
#   2. build-shared — Build the shared package
#   3. build-web   — Build React frontend with Vite
#   4. build-server — Compile Express server TypeScript
#   5. production  — Minimal runtime image
#
# Target image size: < 200MB
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies (shared across build stages)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config and lockfile first (better layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/

# Install all dependencies (dev + prod) for building
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: Build shared package
# ---------------------------------------------------------------------------
FROM deps AS build-shared

COPY shared/ ./shared/
RUN pnpm --filter @veritas-kanban/shared build

# ---------------------------------------------------------------------------
# Stage 3: Build frontend (Vite)
# ---------------------------------------------------------------------------
FROM build-shared AS build-web

# Optional: deploy under a sub-path (e.g., /kanban/) behind a reverse proxy.
# When set, all client-side routes and API calls are prefixed automatically.
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

COPY web/ ./web/
RUN pnpm --filter @veritas-kanban/web build

# ---------------------------------------------------------------------------
# Stage 4: Build server (TypeScript)
# ---------------------------------------------------------------------------
FROM build-shared AS build-server

COPY server/ ./server/
RUN pnpm --filter @veritas-kanban/server build

# ---------------------------------------------------------------------------
# Stage 5: Production runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Security: run as non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S veritas -u 1001 -G nodejs

WORKDIR /app

# Copy workspace config for pnpm (include real web/package.json for lockfile integrity)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/

# Install production-only dependencies
# --ignore-scripts: skip husky prepare hook (not needed in container)
# Note: web deps get installed to satisfy the lockfile, but we remove them
# since the frontend is pre-built as static assets
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    rm -rf web/node_modules && \
    pnpm store prune

# Copy built artifacts
COPY --from=build-shared /app/shared/dist ./shared/dist
COPY --from=build-server /app/server/dist ./server/dist
COPY --from=build-web /app/web/dist ./web/dist

# Create data directories for persistent storage and runtime config
# Note: services resolve .veritas-kanban from both cwd/.. and cwd directly,
# so we create it at /app/ level AND ensure server/ is writable for services
# that use process.cwd()/.veritas-kanban when WORKDIR is /app/server
RUN mkdir -p /app/data /app/.veritas-kanban /app/tasks && \
    chown -R veritas:nodejs /app/data /app/.veritas-kanban /app/tasks /app/server

# Switch to non-root user
USER veritas

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Set working directory to server/ so path.resolve(cwd, '..') resolves to /app
# (Services use process.cwd()/.. to find .veritas-kanban and tasks directories)
WORKDIR /app/server

# Start server
CMD ["node", "dist/index.js"]
