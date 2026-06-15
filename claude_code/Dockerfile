# =============================================================================
# Claude Code — Home Assistant add-on image
# =============================================================================
#
# BUILD CONTEXT: this add-on directory (the one containing config.yaml).
#
#   docker build -f claude_code/Dockerfile -t claude_code claude_code
#
# The whole app (an npm-workspaces monorepo) lives inside this directory, so the
# Home Assistant Supervisor's default build — which uses the add-on directory as
# the Docker build context — works without any special handling. The app is
# built inside the image; no prior `npm run build` on the host is required. A
# .dockerignore in this directory keeps node_modules/dist out of the context.
# =============================================================================

ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

# Re-declare so labels below can reference it, plus add-on metadata args that
# the HA builder passes in.
ARG BUILD_ARCH=amd64
ARG BUILD_VERSION=0.1.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive

# -----------------------------------------------------------------------------
# System dependencies + Node.js 20 (NodeSource) + global agent tooling.
# -----------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        ripgrep \
        gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g \
        @anthropic-ai/claude-code@latest \
        @zed-industries/claude-code-acp@latest \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Build the monorepo app inside the image.
# Context = repo root. Copy manifests + lockfile first for layer caching, then
# the sources, install all deps, build shared+server+web, prune dev deps.
# -----------------------------------------------------------------------------
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY mock-acp/package.json ./mock-acp/
COPY e2e/package.json ./e2e/

# Install workspace deps. e2e is a dev-only workspace; we still need its
# manifest present for the lockfile to resolve. Skip Playwright browser
# downloads which are not needed in the runtime image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# Now copy the actual sources and build.
COPY shared/ ./shared/
COPY server/ ./server/
COPY web/ ./web/
COPY mock-acp/ ./mock-acp/

RUN npm run build \
    && npm prune --omit=dev

# -----------------------------------------------------------------------------
# s6-overlay service definitions (longrun that starts the Fastify server).
# Copy the rootfs from the add-on folder and make the run scripts executable.
# -----------------------------------------------------------------------------
COPY rootfs/ /

RUN chmod +x /etc/s6-overlay/s6-rc.d/claude-server/run

# -----------------------------------------------------------------------------
# Runtime environment. The server reads these; ingress means no ports exposed.
# DATA_DIR/HOME/CLAUDE_CONFIG_DIR all point at the persistent /data volume so
# Claude credentials survive restarts.
# -----------------------------------------------------------------------------
ENV DATA_DIR=/data \
    HOME=/data \
    CLAUDE_CONFIG_DIR=/data \
    PORT=8099 \
    NODE_ENV=production \
    WEB_DIST=/app/web/dist

# Real ACP agent command used by the server in production.
ENV ACP_AGENT_CMD="claude-code-acp"

# OCI / Home Assistant labels.
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    org.opencontainers.image.title="Claude Code" \
    org.opencontainers.image.source="https://github.com/prestomation/claude-ha-addon"

# No EXPOSE — the UI is reached exclusively through Home Assistant ingress.
# s6-overlay (from the base image) is the entrypoint and will start the
# claude-server service. No CMD override needed.
