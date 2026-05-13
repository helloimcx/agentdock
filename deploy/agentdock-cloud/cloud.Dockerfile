FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY services ./services
COPY shared ./shared
COPY tsconfig.electron.json ./
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build:electron

EXPOSE 9831
CMD ["node", "dist-electron/services/agentdock-cloud/src/main.js"]
