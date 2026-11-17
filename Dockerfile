# syntax=docker/dockerfile:1

# ---- build stage: full deps, builds client (dist/) and server bundle (build/) ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public, client-safe values only. NEVER pass SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY or Stripe secrets here:
# build args are visible in image history. Server secrets are injected at runtime by the host.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_BASE_URL=/api
ARG VITE_MOMO_MTN_NUMBER
ARG VITE_MOMO_ORANGE_NUMBER
ARG VITE_MOMO_ACCOUNT_NAME
ARG VITE_MOMO_MTN_NUMBER_USD
ARG VITE_MOMO_MTN_NUMBER_LRD
ARG VITE_MOMO_ORANGE_NUMBER_USD
ARG VITE_MOMO_ORANGE_NUMBER_LRD
ARG VITE_MOMO_ACCOUNT_NAME_USD
ARG VITE_MOMO_ACCOUNT_NAME_LRD
ARG VITE_MOMO_LEGACY_NUMBERS_ACCEPT_LRD
ARG VITE_DEFAULT_CURRENCY
ENV VITE_ENABLE_DEMO_MODE=false \
    VITE_APP_ENV=production
RUN npm run build \
 && npm run check:no-service-key-leak \
 && npm run check:no-seed-pii-in-bundle

# ---- runtime stage: production deps only, non-root ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/build ./build
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/ai/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/server.cjs"]
