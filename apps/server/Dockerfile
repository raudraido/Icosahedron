# Web engine: web UI + sync hub + Navidrome proxy in one container.
# Build context is the repository root:
#   docker build -f apps/server/Dockerfile -t icosahedron .

FROM node:22-alpine AS web
WORKDIR /repo
COPY package.json package-lock.json ./
COPY native/audio-engine/package.json native/audio-engine/
# --ignore-scripts: skip the Rust audio-engine build and Electron download,
# neither is needed for the browser bundle.
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build --config vite.web.config.ts

FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_ROOT=/app/web
COPY --from=deps /app/node_modules ./node_modules
COPY apps/server/package.json ./
COPY apps/server/src ./src
COPY --from=web /repo/dist-web ./web
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "src/index.mjs"]
