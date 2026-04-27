# NPM + Tailscale HTTPS Deployment

This guide documents the quick server deployment path for AgentDock using the published npm package and Tailscale Serve HTTPS.

The intended setup is:

```text
Browser in tailnet
  -> https://agentdock-server.<tailnet>.ts.net/
      -> Tailscale Serve
          -> 127.0.0.1:14173 agentdock web
              /api/local/v1 -> 127.0.0.1:9831 Local AI Core
```

AgentDock and Local AI Core stay bound to localhost on the server. Tailscale exposes the web UI over HTTPS to devices in the tailnet.

## Prerequisites

- Ubuntu server with passwordless SSH access.
- Node.js and npm installed on the server.
- The npm package has been published as `@kafca/agentdock`.
- Access to a Tailscale account and permission to add a new device.
- The client machine that opens the web UI is logged in to the same tailnet.

## Install AgentDock

SSH into the server:

```bash
ssh ubuntu@SERVER_IP
```

Install the package:

```bash
sudo npm install -g @kafca/agentdock
agentdock --help
```

The package provides:

- `agentdock core`
- `agentdock web`
- `agentdock serve`

For server deployment, use `agentdock serve`. It starts Local AI Core and serves the renderer on port `14173`.

## Create the Systemd Service

Create the persistent data directory:

```bash
sudo mkdir -p /var/lib/agentdock
sudo chown ubuntu:ubuntu /var/lib/agentdock
```

Create `/etc/systemd/system/agentdock.service`:

```ini
[Unit]
Description=AgentDock Core and Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
Environment=AI_WORKSTATION_USER_DATA_DIR=/var/lib/agentdock
ExecStart=/usr/bin/agentdock serve --host 127.0.0.1 --port 14173
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agentdock
```

Check local health:

```bash
systemctl status agentdock --no-pager -l
curl http://127.0.0.1:14173/api/local/v1/health
```

Expected response:

```json
{"ok":true,"data":{"name":"local-ai-core","version":"0.1.0"}}
```

## Install and Login to Tailscale

Install Tailscale:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
```

Join the tailnet:

```bash
sudo tailscale up --hostname agentdock-server
```

Open the printed login URL and approve the device.

After login, inspect the node:

```bash
tailscale status --self
tailscale ip -4
```

The DNS name will look like:

```text
agentdock-server.<tailnet>.ts.net
```

## Configure Tailscale HTTPS Serve

Allow the `ubuntu` user to manage Serve:

```bash
sudo tailscale set --operator=ubuntu
```

Expose the local AgentDock web server over tailnet HTTPS:

```bash
tailscale serve --bg 14173
tailscale serve status
```

Expected status:

```text
https://agentdock-server.<tailnet>.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:14173
```

Check HTTPS from the server:

```bash
curl https://agentdock-server.<tailnet>.ts.net/api/local/v1/health
```

Then open the UI from a tailnet client:

```text
https://agentdock-server.<tailnet>.ts.net/#/workspace
```

## Workspace Configuration

Local AI Core reads its runtime config from:

```text
/var/lib/agentdock/runtime/config.toml
```

Inspect runtime state:

```bash
curl http://127.0.0.1:14173/api/local/v1/runtime
curl http://127.0.0.1:14173/api/local/v1/workspaces
```

If the UI opens `#/chat?project=default` but the configured workspace is named differently, sending messages can fail with:

```text
Workspace "default" is not configured as a Local AI Core ACP workspace.
```

Fix by setting the runtime default project to the configured workspace name:

```bash
curl -X POST http://127.0.0.1:14173/api/local/v1/runtime/settings \
  -H "Content-Type: application/json" \
  --data '{"defaultProject":"Obsidian-Work"}'
```

Then open:

```text
https://agentdock-server.<tailnet>.ts.net/#/chat?project=Obsidian-Work
```

Verify workspace access:

```bash
curl "http://127.0.0.1:14173/api/local/v1/threads?workspace_id=Obsidian-Work"
```

## Client-Side Tailscale Routing Check

If the server can access its own Tailscale HTTPS URL but the client browser shows `ERR_CONNECTION_CLOSED` or times out, check the client route to the server's Tailscale IP.

On macOS:

```bash
tailscale status
tailscale ping agentdock-server.<tailnet>.ts.net
route -n get SERVER_TAILSCALE_IP
netstat -rn -f inet | grep '100\.64'
```

The route to the server Tailscale IP should use the Tailscale interface, usually a `utun` interface. If it uses the normal LAN gateway, another VPN or proxy has likely installed a competing route for `100.64.0.0/10`.

Example bad route:

```text
route to: 100.117.118.59
gateway: 192.168.31.1
interface: en0
```

Temporarily fix a single server route:

```bash
sudo route -n add -host 100.117.118.59 -interface utun5
```

Prefer the durable fix: disable or reconfigure the other VPN/proxy so it does not capture `100.64.0.0/10`.

## Maintenance Commands

AgentDock:

```bash
sudo systemctl status agentdock
sudo journalctl -u agentdock -f
sudo systemctl restart agentdock
```

Tailscale:

```bash
tailscale status
tailscale serve status
tailscale serve reset
```

Local checks:

```bash
curl http://127.0.0.1:14173/
curl http://127.0.0.1:14173/api/local/v1/health
curl http://127.0.0.1:9831/api/local/v1/health
```

Tailnet checks:

```bash
curl https://agentdock-server.<tailnet>.ts.net/
curl https://agentdock-server.<tailnet>.ts.net/api/local/v1/health
```

## Notes

- `agentdock serve` defaults to `--host 127.0.0.1 --port 14173`.
- Use `--host 0.0.0.0` only when you intentionally want direct network exposure. The Tailscale Serve path should keep AgentDock bound to localhost.
- The npm deployment build should use the same-origin Core path `/api/local/v1`, so the browser does not try to call its own `127.0.0.1:9831`.
- Tailscale Serve is tailnet-only. Use Funnel only if public internet exposure is explicitly desired.
