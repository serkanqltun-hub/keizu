# Keizu Server image: the sync server plus the Keizu web app, so the server's
# address opens the editor itself (and /panel/ the account panel).
# Build from the repository root:  docker build -f server/Dockerfile .

# 1) The web app (same build as GitHub Pages, served from "/").
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npx vite build --outDir /web

# 2) The server: Node.js + built-in SQLite, no native modules.
FROM node:22-alpine

ENV NODE_ENV=production \
    KEIZU_DATA=/data \
    KEIZU_PORT=8787

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/src ./src
COPY server/public ./public
COPY --from=web /web ./web

# `keizu-server <command>` inside the container (docker compose exec keizu keizu-server …)
RUN printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/src/main.ts "$@"\n' > /usr/local/bin/keizu-server \
 && chmod +x /usr/local/bin/keizu-server \
 && mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
CMD ["keizu-server", "serve"]
