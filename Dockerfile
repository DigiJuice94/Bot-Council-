FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# GitHub's browser uploader can retain root files while dropping nested source
# folders. Restore the one canonical tree and remove any stale nested files
# before compiling so Railway always builds the same verified source.
RUN test -f deployment-source.tar.gz \
  && rm -rf app components lib public \
  && tar -xzf deployment-source.tar.gz
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
