import type { DatabaseSync } from 'node:sqlite';
import type {
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopProviderConfig,
} from '@cc/superai-contracts';
import type { LocalModelProviderRow } from './acp-store-types.js';
import { parseJson } from './utils.js';

export class LocalModelProviderStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): DesktopModelProvider[] {
    const rows = this.db.prepare(`
      SELECT id, name, api_key, base_url, model, models_json, thinking, env_json, unit_price_in, unit_price_out, unit_price_cache, created_at, updated_at
      FROM model_providers
      ORDER BY name ASC, id ASC
    `).all() as LocalModelProviderRow[];
    return rows.map((row) => this.toProvider(row));
  }

  get(providerId: string): DesktopModelProvider | undefined {
    const row = this.db.prepare(`
      SELECT id, name, api_key, base_url, model, models_json, thinking, env_json, unit_price_in, unit_price_out, unit_price_cache, created_at, updated_at
      FROM model_providers
      WHERE id = ?
    `).get(providerId) as LocalModelProviderRow | undefined;
    return row ? this.toProvider(row) : undefined;
  }

  upsert(input: DesktopModelProviderInput | DesktopProviderConfig): DesktopModelProvider {
    const now = new Date().toISOString();
    const requestedId = String((input as DesktopModelProviderInput).id || '').trim();
    const id = requestedId || this.allocateProviderId(input.name);
    const existing = this.get(id);
    this.db.prepare(`
      INSERT INTO model_providers (
        id, name, api_key, base_url, model, models_json, thinking, env_json, unit_price_in, unit_price_out, unit_price_cache, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        api_key = excluded.api_key,
        base_url = excluded.base_url,
        model = excluded.model,
        models_json = excluded.models_json,
        thinking = excluded.thinking,
        env_json = excluded.env_json,
        unit_price_in = excluded.unit_price_in,
        unit_price_out = excluded.unit_price_out,
        unit_price_cache = excluded.unit_price_cache,
        updated_at = excluded.updated_at
    `).run(
      id,
      String(input.name || id).trim() || id,
      stringOrNull(input.api_key),
      stringOrNull(input.base_url),
      stringOrNull(input.model),
      JSON.stringify(Array.isArray(input.models) ? input.models : []),
      stringOrNull(input.thinking),
      JSON.stringify(input.env && typeof input.env === 'object' ? input.env : {}),
      numberOrNull(input.unit_price_in),
      numberOrNull(input.unit_price_out),
      numberOrNull(input.unit_price_cache),
      existing?.createdAt || now,
      now,
    );
    return this.get(id)!;
  }

  delete(providerId: string) {
    this.db.prepare('DELETE FROM model_providers WHERE id = ?').run(providerId);
    return { deleted: true };
  }

  private allocateProviderId(name: string) {
    const base = slugifyProviderId(name, 'provider');
    let candidate = base;
    let index = 2;
    while (this.get(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private toProvider(row: LocalModelProviderRow): DesktopModelProvider {
    return {
      id: row.id,
      name: row.name,
      api_key: row.api_key || undefined,
      base_url: row.base_url || undefined,
      model: row.model || undefined,
      models: parseJson(row.models_json, []),
      thinking: row.thinking || undefined,
      env: parseJson(row.env_json, {}),
      unit_price_in: row.unit_price_in !== null && row.unit_price_in !== undefined ? Number(row.unit_price_in) : undefined,
      unit_price_out: row.unit_price_out !== null && row.unit_price_out !== undefined ? Number(row.unit_price_out) : undefined,
      unit_price_cache: row.unit_price_cache !== null && row.unit_price_cache !== undefined ? Number(row.unit_price_cache) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function slugifyProviderId(value: string, fallback: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function stringOrNull(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

