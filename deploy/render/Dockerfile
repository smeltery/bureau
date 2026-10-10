FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential ca-certificates git tini chromium && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/bureau
COPY . .
RUN bun install --frozen-lockfile && bun run build:ui && mkdir -p /var/data && chown node:node /var/data
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "bash", "deploy/render/entrypoint.sh"]
