# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g npm@11

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY e2e/package.json e2e/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  DATABASE_PATH=/tmp/incident-board.db \
  SEED_ON_BOOT=true \
  AI_ENABLED=false \
  WEB_DIST_PATH=/app/apps/web/dist \
  CORS_ORIGIN=*

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist

USER node
EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]
