# ─── Build stage ──────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Runtime stage ────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY server.js     ./
COPY package.json  ./
COPY public/       ./public/

# Seed the data directory with the default config; the volume mount in
# docker-compose will overlay this directory at runtime so all writes are
# persisted outside the image.  On a fresh volume Docker copies these
# files in automatically before the container starts.
RUN mkdir -p /app/data && chown -R node:node /app/data
COPY --chown=node:node data/discord-roles.json ./data/

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

CMD ["node", "server.js"]