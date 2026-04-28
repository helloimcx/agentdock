# Tailscale-only Cache Proxy

This note documents the AgentDock cache proxy deployed on the Aliyun tailnet node.

## Goal

Keep AgentDock private to the tailnet while reducing static asset load time from China networks. The proxy does not listen on the Aliyun public IP. Tailscale Serve exposes a local-only proxy over tailnet HTTPS.

## Current Deployment

- Cache node: `aliyun-8-166-128-104.tail4df241.ts.net`
- Cache node Tailscale IP: `100.92.40.5`
- Upstream node: `agentdock-server.tail4df241.ts.net`
- Upstream Tailscale IP: `100.117.118.59`
- Local proxy: `127.0.0.1:11417`
- Tailnet URL: `https://aliyun-8-166-128-104.tail4df241.ts.net/`
- Systemd unit: `agentdock-tailnet-proxy.service`
- Proxy script: `/opt/agentdock-tailnet-proxy/proxy.py`
- Cache directory: `/var/cache/agentdock-tailnet-proxy`

Tailscale Serve status should show:

```text
https://aliyun-8-166-128-104.tail4df241.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:11417
```

## Behavior

- `/assets/*` responses are cached on the Aliyun node.
- HTML and API responses are proxied but not cached.
- The proxy preserves upstream response headers and adds `X-AgentDock-Cache: HIT` or `MISS`.
- The service binds only to `127.0.0.1`; Tailscale Serve is the only external entrypoint.

## Commands

Check service state:

```bash
sudo systemctl status agentdock-tailnet-proxy
sudo tailscale serve status
```

Restart the local proxy:

```bash
sudo systemctl restart agentdock-tailnet-proxy
```

Clear cached assets:

```bash
sudo find /var/cache/agentdock-tailnet-proxy -type f -delete
```

Disable the tailnet HTTPS entrypoint:

```bash
sudo tailscale serve --https=443 off
```

Re-enable the tailnet HTTPS entrypoint:

```bash
sudo tailscale serve --bg --yes 11417
```

## Verification

From any tailnet node that can reach the Aliyun node:

```bash
curl --compressed -D /tmp/agentdock-cache.headers \
  -o /tmp/agentdock-cache.js \
  -w 'total=%{time_total} ttfb=%{time_starttransfer} size=%{size_download} speed=%{speed_download}\n' \
  https://aliyun-8-166-128-104.tail4df241.ts.net/assets/index-B2JL40NF.js

grep -i x-agentdock-cache /tmp/agentdock-cache.headers
```

Expected:

- First request: `X-AgentDock-Cache: MISS`
- Later requests for the same asset and encoding: `X-AgentDock-Cache: HIT`

## Notes From Initial Validation

- `agentdock-server` can reach the Aliyun HTTPS Serve entrypoint.
- Current Mac validation could not connect to Aliyun over Tailscale TCP; `tailscale ping` from Aliyun to `macbook-pro-2` used `DERP(sfo)` and did not establish direct connectivity.
- This is separate from the proxy deployment. The proxy and Tailscale Serve are running, but Mac access depends on tailnet ACL/connectivity between `macbook-pro-2` and `aliyun-8-166-128-104`.
- Aliyun Tailscale DNS originally prevented HTTPS certificate retrieval. The node now uses system DNS with `accept-dns=false`, and `/etc/hosts` pins `agentdock-server.tail4df241.ts.net` to `100.117.118.59`.

## Troubleshooting

If HTTPS handshakes fail, check certificate retrieval:

```bash
sudo tailscale cert aliyun-8-166-128-104.tail4df241.ts.net
sudo journalctl -u tailscaled --since '10 minutes ago' --no-pager
```

If a client cannot connect to the Aliyun URL, verify Tailscale path and ACLs:

```bash
tailscale ping aliyun-8-166-128-104
nc -vz aliyun-8-166-128-104.tail4df241.ts.net 443
```

On the Aliyun node:

```bash
tailscale ping macbook-pro-2
sudo iptables -S ts-input
sudo tailscale serve status
```
