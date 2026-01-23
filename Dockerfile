FROM oven/bun:1.1.38-alpine AS deps
WORKDIR /app

COPY package.json ./
RUN bun install

FROM oven/bun:1.1.38-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
CMD ["bun", "run", "start"]