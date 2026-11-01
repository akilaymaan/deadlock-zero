# syntax=docker/dockerfile:1

# ---- Build stage: install all dependencies, verify, and build ----
FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .nvmrc ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# ---- Runtime stage: production dependencies and built output only ----
FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server/index.js"]
