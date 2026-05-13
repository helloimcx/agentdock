FROM node:24-bookworm-slim

WORKDIR /workspace
RUN npm install -g pi-acp @mariozechner/pi-coding-agent
COPY runtime.mjs /opt/agentdock/runtime.mjs

ENV AGENTDOCK_TASK_DIR=/workspace/.agentdock/task
ENV AGENTDOCK_OUTPUT_DIR=/workspace/.agentdock/output
CMD ["node", "/opt/agentdock/runtime.mjs"]
