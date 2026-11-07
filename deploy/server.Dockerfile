FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund && npx tsup apps/core-api/src/main.ts apps/worker/src/main.ts --format esm --out-dir dist/server --splitting --external pg
FROM node:22.20.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
USER node
CMD ["node", "dist/server/core-api/src/main.js"]
