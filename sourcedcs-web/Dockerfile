# ─── Build stage ──────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Runtime stage ────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY server.js             ./
COPY discord-gateway.js    ./
COPY activity-score.js     ./
COPY activity-daily-job.js ./
COPY package.json          ./
COPY config.json           ./
COPY public/                ./public/
COPY scripts/               ./scripts/

RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

CMD ["node", "server.js"]