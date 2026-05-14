FROM node:22-bookworm-slim

WORKDIR /opt/agentdock

RUN npm init -y \
  && npm install --omit=dev pi-acp @mariozechner/pi-coding-agent \
  && ln -sf /opt/agentdock/node_modules/.bin/pi-acp /usr/local/bin/pi-acp \
  && ln -sf /opt/agentdock/node_modules/.bin/pi /usr/local/bin/pi

COPY docker/agentdock/acp-http-bridge.mjs /opt/agentdock/acp-bridge.mjs

ENV NODE_ENV=production
ENV PATH=/opt/agentdock/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV AGENTDOCK_ACP_COMMAND=pi-acp
ENV AGENTDOCK_ACP_PORT=8080
ENV PI_CODING_AGENT_DIR=/agent-state/pi
ENV AGENTDOCK_ACP_STATE_DIRS='["/agent-state/pi"]'

EXPOSE 8080

ENTRYPOINT ["node", "/opt/agentdock/acp-bridge.mjs"]
