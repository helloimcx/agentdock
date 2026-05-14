FROM node:22-bookworm-slim

WORKDIR /opt/agentdock

COPY docker/fake-acp/fake-acp.mjs /opt/agentdock/fake-acp.mjs
COPY docker/agentdock/acp-http-bridge.mjs /opt/agentdock/acp-bridge.mjs

ENV NODE_ENV=production
ENV AGENTDOCK_ACP_PORT=8080
ENV AGENTDOCK_ACP_COMMAND=/usr/local/bin/node
ENV AGENTDOCK_ACP_ARGS='["/opt/agentdock/fake-acp.mjs"]'

EXPOSE 8080
ENTRYPOINT ["node", "/opt/agentdock/acp-bridge.mjs"]
