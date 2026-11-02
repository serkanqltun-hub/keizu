# Keizu Server image: Node.js + built-in SQLite, no native modules.
FROM node:22-alpine

ENV NODE_ENV=production \
    KEIZU_DATA=/data \
    KEIZU_PORT=8787

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public

# `keizu-server <command>` inside the container (docker compose exec keizu keizu-server …)
RUN printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/src/main.ts "$@"\n' > /usr/local/bin/keizu-server \
 && chmod +x /usr/local/bin/keizu-server \
 && mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
CMD ["keizu-server", "serve"]
