import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { MeshNode, TailscaleBindInput, TailscalePeer, TailscaleStatusResponse } from '@cc/superai-contracts';
import type { MeshStore } from './mesh-store.js';

function resolveTailscaleBin(): string {
  if (process.env.TAILSCALE_CMD && existsSync(process.env.TAILSCALE_CMD)) {
    return process.env.TAILSCALE_CMD;
  }
  const candidates = [
    '/usr/local/bin/tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/bin/tailscale',
    '/bin/tailscale',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'tailscale';
}

function defaultTailscaleRunner(): Promise<string> {
  const bin = resolveTailscaleBin();
  return new Promise((resolve, reject) => {
    execFile(bin, ['status', '--json'], { timeout: 3500, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

export class TailscaleService {
  constructor(
    private readonly store: MeshStore,
    private readonly runner: () => Promise<string> = defaultTailscaleRunner,
  ) {}

  async getStatus(): Promise<TailscaleStatusResponse> {
    try {
      const raw = await this.runner();
      const data = JSON.parse(raw) as {
        Self?: {
          ID?: string;
          PublicKey?: string;
          HostName?: string;
          DNSName?: string;
          TailscaleIPs?: string[];
          OS?: string;
          Online?: boolean;
        };
        Peer?: Record<string, {
          ID?: string;
          PublicKey?: string;
          HostName?: string;
          DNSName?: string;
          TailscaleIPs?: string[];
          OS?: string;
          Online?: boolean;
        }>;
      };

      const meshNodes = this.store.listNodes();

      let self: TailscalePeer | undefined;
      if (data.Self) {
        self = {
          id: data.Self.PublicKey || data.Self.ID || 'self',
          name: data.Self.HostName || 'self',
          dnsName: data.Self.DNSName || '',
          ips: data.Self.TailscaleIPs || [],
          os: data.Self.OS || 'unknown',
          online: Boolean(data.Self.Online),
          isSelf: true,
        };
      }

      const peers: TailscalePeer[] = [];
      if (data.Peer) {
        for (const [key, p] of Object.entries(data.Peer)) {
          const name = p.HostName || key;
          const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
          const expectedId = `node:ts:${safeName}`;
          const matchedMeshNode = meshNodes.find(
            n => n.id === expectedId || n.id === `node:${safeName}` || n.label.startsWith(name),
          );

          peers.push({
            id: p.PublicKey || p.ID || key,
            name,
            dnsName: p.DNSName || '',
            ips: p.TailscaleIPs || [],
            os: p.OS || 'unknown',
            online: Boolean(p.Online),
            isSelf: false,
            meshNodeId: matchedMeshNode?.id,
          });
        }
      }

      // Sort: online first, then by name
      peers.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { available: true, self, peers };
    } catch (cause) {
      return {
        available: false,
        error: cause instanceof Error ? cause.message : String(cause),
        peers: [],
      };
    }
  }

  bindNode(input: TailscaleBindInput): MeshNode {
    const rawName = input.name.trim();
    if (!rawName) throw new Error('Device name is required for binding.');
    const cleaned = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const fallback = input.dnsName ? input.dnsName.split('.')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
    const safeName = cleaned || fallback || 'peer';
    const id = `node:ts:${safeName}`;

    const existing = this.store.getNode(id);
    const allowShell = input.allowShell !== false;
    const now = new Date().toISOString();

    const node: MeshNode = {
      id,
      label: `${rawName} (${input.os || 'tailscale'})`,
      platform: input.os || existing?.platform || 'unknown',
      capabilities: allowShell
        ? ['filesystem.list', 'filesystem.read', 'filesystem.write', 'shell.exec']
        : ['filesystem.list', 'filesystem.read', 'filesystem.write'],
      allowedCapabilities: allowShell
        ? ['filesystem.list', 'filesystem.read', 'filesystem.write', 'shell.exec']
        : ['filesystem.list', 'filesystem.read', 'filesystem.write'],
      status: 'online',
      lastSeenAt: now,
      createdAt: existing?.createdAt || now,
    };

    this.store.upsertNode(node);
    return node;
  }
}
