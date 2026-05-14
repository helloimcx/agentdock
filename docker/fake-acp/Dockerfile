FROM node:22-bookworm-slim

WORKDIR /opt/agentdock

RUN npm init -y && npm install --omit=dev ws

COPY docker/fake-acp/fake-acp.mjs /opt/agentdock/fake-acp.mjs

ENV NODE_ENV=production
ENV AGENTDOCK_ACP_PORT=8080

EXPOSE 8080
ENTRYPOINT ["node", "/opt/agentdock/fake-acp.mjs"]
