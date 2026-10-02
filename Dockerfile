# syntax=docker/dockerfile:1
# bafft on Unraid (bafft-c4d.4): one container, API + web app on one port,
# data (SQLite db, audio, pictures, sounds) on the /data volume.

# --- build: install the workspace, build the web app, drop dev deps.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY packages packages
RUN npm run build --workspace @bafft/web && npm prune --omit=dev

# --- runtime. The server runs from its TypeScript source with tsx, as in dev,
# so the shared package needs no separate build.
FROM node:24-slim
ENV NODE_ENV=production \
    BAFFT_DATA_DIR=/data \
    BAFFT_WEB_ROOT=/app/packages/web/dist \
    PORT=8792
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/server packages/server
COPY --from=build /app/packages/web/dist packages/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8792
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:8792/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "packages/server/src/index.ts"]
