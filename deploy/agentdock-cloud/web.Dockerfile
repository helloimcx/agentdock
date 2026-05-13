FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src ./src
COPY public ./public
COPY packages ./packages
COPY shared ./shared
COPY index.html vite.config.ts tsconfig.json ./
RUN corepack enable && pnpm install --frozen-lockfile
ENV VITE_LOCAL_AI_CORE_BASE=/api/local/v1
RUN pnpm build:renderer

FROM nginx:1.27-alpine
COPY --from=build /app/dist/renderer /usr/share/nginx/html
COPY deploy/agentdock-cloud/nginx.conf /etc/nginx/conf.d/default.conf
