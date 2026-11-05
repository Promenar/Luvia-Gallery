FROM node:24-trixie-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
COPY . .
RUN pnpm install --prod --filter @luvia/server... --frozen-lockfile

FROM dependencies AS frontend
RUN if [ -f apps/web/package.json ]; then \
      pnpm install --frozen-lockfile && pnpm --filter @luvia/web build; \
    else \
      mkdir -p apps/web/dist; \
    fi

FROM node:24-trixie-slim AS runtime
WORKDIR /app/apps/server
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /cache \
    && chown node:node /data /cache
COPY --from=dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --from=dependencies --chown=node:node /app/apps/server /app/apps/server
COPY --from=dependencies --chown=node:node /app/packages/contracts /app/packages/contracts
COPY --from=frontend --chown=node:node /app/apps/web/dist /app/apps/web/dist
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data CACHE_DIR=/cache
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/api/main.ts"]
