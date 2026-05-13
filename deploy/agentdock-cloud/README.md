# AgentDock Cloud Compose

Build images:

```bash
docker compose --profile build-only build agent-sandbox-runtime agentdock-cloud web
```

Start Cloud MVP:

```bash
docker compose up web agentdock-cloud rocketmq-namesrv rocketmq-broker opensandbox-server
```

Cloud Web is exposed on `http://127.0.0.1:8080`. AgentDock Cloud exposes the local-compatible API at `http://127.0.0.1:9831/api/local/v1`.

The compose default uses RocketMQ Proxy, OpenSandbox, and the locally built sandbox image `agentdock/pi-sandbox-runtime:local`. For host-only flow testing without Docker sandbox execution, set `AGENTDOCK_CLOUD_SANDBOX_PROVIDER=fake` and `AGENTDOCK_CLOUD_EVENT_BUS=memory` on `agentdock-cloud`.
