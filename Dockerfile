# =============================================================================
# Veritas Kanban — Production Multi-Stage Dockerfile
# =============================================================================
# Stages:
#   1. deps        — Install all workspace dependencies (shared cache layer)
#   2. build-shared — Build the shared package
#   3. build-web   — Build React frontend with Vite
#   4. build-server — Compile the Express server TypeScript
#   5. production-deps — Install the server-only runtime closure
#   6. production  — Minimal runtime image
#
# Target image size: < 200,000,000 bytes
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies (shared across build stages)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

WORKDIR /app

# Copy workspace config and lockfile first (better layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY cli/package.json ./cli/
COPY mcp/package.json ./mcp/
COPY scripts/ ./scripts/

# Install all dependencies (dev + prod) for building
ENV HUSKY=0
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
# Stage 5: Install the server-only production dependency closure
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production-deps

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY scripts/ ./scripts/
RUN corepack enable && \
    corepack prepare pnpm@11.1.1 --activate && \
    HUSKY=0 pnpm install --frozen-lockfile --prod --filter @veritas-kanban/server... && \
    rm -rf /root/.cache/node/corepack /root/.local/share/pnpm/store /root/.local/share/pnpm/.tools

# ---------------------------------------------------------------------------
# Stage 6: Production runtime
# ---------------------------------------------------------------------------
# The matching Alpine base keeps Node's musl ABI while excluding npm,
# Corepack, headers, and package-manager tooling from the runtime image.
FROM alpine:3.24 AS production

RUN apk add --no-cache libstdc++ && \
    addgroup -g 1001 -S nodejs && \
    adduser -S veritas -u 1001 -G nodejs

COPY --from=production-deps /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# Copy only the resolved server runtime closure. The platform-specific Codex
# binary remains available, while npm, pnpm, workspace manifests, and build
# tooling never enter the production stage.
COPY --from=production-deps --chown=veritas:nodejs /app/node_modules ./node_modules
COPY --from=production-deps --chown=veritas:nodejs /app/server/node_modules ./server/node_modules

# Copy only built runtime artifacts. CLI, MCP, frontend dependencies, source,
# and build tooling never enter the production stage.
COPY --from=build-shared --chown=veritas:nodejs /app/shared/dist ./shared/dist
COPY --from=build-server --chown=veritas:nodejs /app/server/dist ./server/dist
COPY --from=build-web --chown=veritas:nodejs /app/web/dist ./web/dist

# Create the single volume-backed storage root. Runtime state is stored at
# /app/data/.veritas-kanban and task data at /app/data/tasks.
RUN mkdir -p /app/data && \
    chown -R veritas:nodejs /app/data /app/server

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

# The runtime path contract is independent of cwd when DATA_DIR is set.
WORKDIR /app/server

# Start server
CMD ["node", "dist/index.js"]
