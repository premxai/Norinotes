# One file, two images:
#   docker build --target api    -t norinote-api .
#   docker build --target worker -t norinote-worker .
# Both run the TypeScript sources with tsx, as in development. Only the API and worker workspaces are installed;
# the web apps are deployed to Vercel and are left out by .dockerignore.

ARG PLAYWRIGHT_VERSION=1.64.1

# ---------------------------------------------------------------------------------------------------------------------
# API: no browser. It imports @norinote/apply for state changes only and never launches Chromium.
# ---------------------------------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_update_notifier=false
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/ packages/
RUN npm ci --include=dev -w @norinote/api -w @norinote/worker --include-workspace-root && npm cache clean --force
COPY apps/api/ apps/api/
# Uploaded resumes and generated files go under ./data (ARTIFACTS_DIR defaults to ./data/artifacts).
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 4000
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]

# ---------------------------------------------------------------------------------------------------------------------
# Worker: collection, matching, tailoring (PDFs via Chromium) and applying. The Playwright image carries Chromium and
# its system libraries; its version must match the playwright package in package-lock.json.
# ---------------------------------------------------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS worker
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npm_config_update_notifier=false
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/ packages/
RUN npm ci --include=dev -w @norinote/api -w @norinote/worker --include-workspace-root && npm cache clean --force
COPY apps/worker/ apps/worker/
COPY scripts/ scripts/
RUN mkdir -p data && chown pwuser:pwuser data
USER pwuser
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
