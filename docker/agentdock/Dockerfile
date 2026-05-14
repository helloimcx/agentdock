FROM node:22-bookworm-slim

WORKDIR /opt/agentdock

ENV NODE_ENV=production
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:/opt/agentdock/node_modules/.bin:$PATH

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/core-sdk/package.json ./packages/core-sdk/package.json
COPY packages/knowledge-api/package.json ./packages/knowledge-api/package.json
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY services/local-ai-core/package.json ./services/local-ai-core/package.json

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY services ./services
COPY shared ./shared
COPY src ./src
COPY public ./public
COPY electron ./electron
COPY bin ./bin
COPY scripts ./scripts
COPY vite.config.ts vite-env.d.ts tsconfig*.json postcss.config.js tailwind.config.ts index.html ./

RUN pnpm build:npm

EXPOSE 9831 14173

CMD ["node", "bin/agentdock.mjs", "serve", "--host", "0.0.0.0"]
