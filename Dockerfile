FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Support the current flat GitHub upload as well as a future clean checkout.
# The archive already in this repository contains the V3.6.2 source folders.
RUN if [ ! -f app/page.tsx ] && [ -f deployment-source.tar.gz ]; then \
      tar -xzf deployment-source.tar.gz; \
    fi \
    && test -f app/page.tsx \
    && test -f app/layout.tsx \
    && test -f app/api/paper-reset/route.ts \
    && test -d components \
    && test -d lib \
    && test -d public
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS=--max-old-space-size=3072
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
