FROM node:22-bookworm-slim

WORKDIR /opt/agentdock

ENV NODE_ENV=production
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:/opt/agentdock/node_modules/.bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap socat ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/knowledge/package.json ./packages/knowledge/package.json
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=agentdock-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps
COPY bin ./bin
COPY scripts ./scripts
COPY tsconfig*.json ./
RUN pnpm build:electron

EXPOSE 9831
CMD ["node", "bin/agentdock.mjs", "daemon"]
