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
COPY data/         ./data/

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node

CMD ["node", "server.js"]
