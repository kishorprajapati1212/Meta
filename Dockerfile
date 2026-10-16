# ─────────────────────────────────────────────────────────────────────────────
#  Meta Social & SEO Analytics — API + Pulse dashboard in one image.
#
#  Stage 1 builds the React dashboard; stage 2 is a minimal runtime that
#  serves both the API and the built dashboard at /app.
#
#    docker build -t meta-analytics .
#    docker run --env-file .env -p 5000:5000 meta-analytics
#
#  Or use docker compose (see docker-compose.yml), which can also run a
#  credential-free demo stack:  docker compose --profile mock up
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the dashboard ────────────────────────────────────────────
FROM node:20-alpine AS build-ui
WORKDIR /app/Pulse

# Dependency layer first so rebuilds are cached.
COPY Pulse/package.json Pulse/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY Pulse/ ./
RUN npm run build


# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Only production dependencies of the API.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Application code, static docs and the built dashboard.
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY --from=build-ui /app/Pulse/dist ./Pulse/dist

# Run as an unprivileged user.
USER node

EXPOSE 5000

# BusyBox wget is present in alpine; /api/health answers without credentials.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "src/app.js"]
