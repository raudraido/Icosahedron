# Icosahedron HUB: web UI + sync hub + Navidrome proxy in one container.
# Build context is the repository root:
#   docker build -f apps/server/Dockerfile -t icosahedron .

# The web app is static: build it once on the build host, not per target architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
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

# The BPM analyser (native/bpm-cli): the same QM-DSP detection the desktop app uses, as a small
# command line program the HUB runs on songs it fetches from Navidrome. Built for the image's own
# architecture (musl, like the final alpine image), so under QEMU for linux/arm64. Only the two
# crates it needs are copied, so a change elsewhere in the repository does not rebuild it.
FROM rust:1-alpine AS bpm
RUN apk add --no-cache build-base
WORKDIR /src
COPY native/bpm-core native/bpm-core
COPY native/bpm-cli native/bpm-cli
WORKDIR /src/native/bpm-cli
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/native/bpm-cli/target \
    cargo build --release --locked \
 && cp target/release/icosahedron-bpm /icosahedron-bpm

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_ROOT=/app/web
COPY --from=bpm /icosahedron-bpm /usr/local/bin/icosahedron-bpm
COPY --from=deps /app/node_modules ./node_modules
COPY apps/server/package.json ./
COPY apps/server/src ./src
COPY --from=web /repo/dist-web ./web
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "src/index.mjs"]
