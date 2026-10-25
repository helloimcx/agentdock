import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type TailscaleBindInput, type TailscalePeer, type TailscaleStatusResponse } from '@cc/superai-contracts';
import type { MeshStore } from './mesh-store.js';

function resolveTailscaleBin(): string {
  if (process.env.TAILSCALE_CMD) {
    if (existsSync(process.env.TAILSCALE_CMD)) {
      return process.env.TAILSCALE_CMD;
    }
    throw new Error(`Configured TAILSCALE_CMD not found: ${process.env.TAILSCALE_CMD}`);
  }
  const candidates = [
    '/usr/local/bin/tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/bin/tailscale',
    '/bin/tailscale',
    'C:\\Program Files\\Tailscale\\tailscale.exe',
    'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'tailscale';
}

function defaultTailscaleRunner(): Promise<string> {
  const bin = resolveTailscaleBin();
  return new Promise((resolve, reject) => {
    execFile(bin, ['status', '--json'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

type RawTailscalePeer = {
  ID?: string;
  PublicKey?: string;
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  OS?: string;
  Online?: boolean;
};

function parseSelfPeer(raw?: RawTailscalePeer): TailscalePeer | undefined {
  if (!raw) return undefined;
  return {
    id: raw.ID || raw.PublicKey || 'self',
    stableIdentity: Boolean(raw.ID),
    name: raw.HostName || 'self',
    dnsName: raw.DNSName || '',
    ips: raw.TailscaleIPs || [],
    os: raw.OS || 'unknown',
    online: Boolean(raw.Online),
    isSelf: true,
  };
}

function parseRemotePeers(peerMap: Record<string, RawTailscalePeer> | undefined): TailscalePeer[] {
  if (!peerMap) return [];
  const peers: TailscalePeer[] = [];
  for (const [key, p] of Object.entries(peerMap)) {
    const name = p.HostName || key;

    peers.push({
      id: p.ID || p.PublicKey || key,
      stableIdentity: Boolean(p.ID),
      name,
      dnsName: p.DNSName || '',
      ips: p.TailscaleIPs || [],
      os: p.OS || 'unknown',
      online: Boolean(p.Online),
      isSelf: false,
    });
  }
  return peers.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export class TailscaleService {
  private cachedStatus?: { response: TailscaleStatusResponse; expiresAt: number };
  private inflightStatus?: Promise<TailscaleStatusResponse>;
  private cacheVersion = 0;

  constructor(
    private readonly store: MeshStore,
    private readonly runner: () => Promise<string> = defaultTailscaleRunner,
    private readonly cacheTtlMs: number = 5000,
  ) {}

  async getStatus(forceRefresh = false): Promise<TailscaleStatusResponse> {
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && this.cachedStatus.expiresAt > now) {
      return this.project(this.cachedStatus.response);
    }
    if (this.inflightStatus) {
      return this.inflightStatus.then(response => this.project(response));
    }
    const currentVersion = this.cacheVersion;
    this.inflightStatus = this.fetchStatus()
      .then(response => {
        if (response.available && this.cacheVersion === currentVersion) {
          this.cachedStatus = { response, expiresAt: Date.now() + this.cacheTtlMs };
        }
        return response;
      })
      .finally(() => {
        this.inflightStatus = undefined;
      });
    return this.inflightStatus.then(response => this.project(response));
  }

  private async fetchStatus(): Promise<TailscaleStatusResponse> {
    try {
      const raw = await this.runner();
      const data = JSON.parse(raw) as {
        Self?: RawTailscalePeer;
        Peer?: Record<string, RawTailscalePeer>;
      };
      const self = parseSelfPeer(data.Self);
      const peers = parseRemotePeers(data.Peer);

      return { available: true, self, peers };
    } catch (cause) {
      return {
        available: false,
        error: cause instanceof Error ? cause.message : String(cause),
        peers: [],
      };
    }
  }

  private project(response: TailscaleStatusResponse): TailscaleStatusResponse {
    return { ...response, peers: response.peers.map(peer => {
      const connection = peer.stableIdentity ? this.store.onboarding.forPeer(peer.id) : undefined;
      const node = connection?.nodeId ? this.store.getNode(connection.nodeId) : undefined;
      return { ...peer, meshNodeId: node?.id, meshNodeStatus: node?.status, connectionId: connection?.id,
        connectionStatus: connection?.status === 'ready' && node?.status !== 'online' ? 'offline' : connection?.status };
    }) };
  }

  /** Kept as a clear migration error for callers of the pre-enrollment inventory API. */
  bindNode(_input: TailscaleBindInput): never {
    throw new Error('Inventory-only binding is retired. Use secure SSH device onboarding.');
  }
}
