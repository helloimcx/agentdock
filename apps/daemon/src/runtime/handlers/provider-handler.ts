import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { DesktopConnectConfig, DesktopModelProviderInput, DesktopProjectConfig } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

const providerSchema = {
  id: 'string', name: { kind: 'string', required: true }, api_key: 'string', base_url: 'string', model: 'string',
  models: 'array', thinking: 'string', env: 'object',
  unit_price_in: 'number', unit_price_out: 'number', unit_price_cache: 'number',
} as const;

const DELETE_BODY_MAX_BYTES = 4096;

export class ProviderInUseError extends Error {
  readonly statusCode = 409;
  readonly dependents: string[];
  constructor(providerId: string, dependents: string[]) {
    super(
      `Provider "${providerId}" is still referenced by ${dependents.length} workspace(s): ${dependents.join(', ')}. `
      + 'Remove the workspace references first, or pass replacement_provider_id to repoint them.',
    );
    this.name = 'ProviderInUseError';
    this.dependents = dependents;
  }
}

function projectProviderId(project: DesktopProjectConfig): string {
  const options = project.agent?.options;
  return String((options as { provider_id?: unknown } | undefined)?.provider_id || '').trim();
}

function workspaceLabel(project: DesktopProjectConfig): string {
  const candidate = project.workspace_id || project.name || '<unnamed>';
  return String(candidate).trim() || '<unnamed>';
}

function withProviderId(project: DesktopProjectConfig, providerId: string): DesktopProjectConfig {
  const options = project.agent?.options && typeof project.agent.options === 'object'
    ? { ...(project.agent.options as Record<string, unknown>) }
    : {};
  options.provider_id = providerId;
  return {
    ...project,
    agent: {
      ...(project.agent || {}),
      options,
    },
  };
}

export function registerProviderHandlers(
  map: Map<string, RouteHandler>,
  store: LocalCoreAcpStore,
  controller: { saveRuntimeConfig: (config: DesktopConnectConfig) => Promise<unknown> },
) {
  map.set('providers.list', async (_route, _req, res) => {
    json(res, 200, { providers: store.listModelProviders() });
  });
  map.set('providers.create', async (_route, req, res) => {
    const body = validateBody<DesktopModelProviderInput>(await readJsonBody(req), providerSchema);
    json(res, 200, await store.upsertModelProvider(body));
  });
  map.set('provider.update', async (route, req, res) => {
    const body = validateBody<DesktopModelProviderInput>(await readJsonBody(req), providerSchema);
    const existing = store.getModelProvider((route as { providerId: string }).providerId);
    if (!existing) {
      throw new Error(`Provider not found: ${(route as { providerId: string }).providerId}`);
    }
    json(res, 200, store.upsertModelProvider({ ...body, id: (route as { providerId: string }).providerId }));
  });
  map.set('provider.delete', async (route, req, res) => {
    const providerId = (route as { providerId: string }).providerId;
    const body = await readJsonBody(req, DELETE_BODY_MAX_BYTES);
    const replacementProviderId = typeof body.replacement_provider_id === 'string'
      ? body.replacement_provider_id.trim()
      : '';
    if (replacementProviderId && replacementProviderId === providerId) {
      throw new Error(`Replacement provider must differ from the provider being deleted: ${providerId}`);
    }
    if (replacementProviderId && !store.getModelProvider(replacementProviderId)) {
      throw new Error(`Replacement provider not found: ${replacementProviderId}`);
    }
    const configState = store.readRuntimeConfig();
    const projects = Array.isArray(configState.config?.projects) ? configState.config.projects : [];
    const dependents = projects.filter((project) => projectProviderId(project) === providerId);
    if (dependents.length) {
      if (!replacementProviderId) {
        throw new ProviderInUseError(providerId, dependents.map((project) => workspaceLabel(project)));
      }
      const repointed = projects.map((project) => (
        projectProviderId(project) === providerId ? withProviderId(project, replacementProviderId) : project
      ));
      // Persist the repoint before deleting: if the save fails, the old provider
      // row survives and no workspace is left with a dangling reference.
      await controller.saveRuntimeConfig({ ...configState.config, projects: repointed });
    }
    json(res, 200, store.deleteModelProvider(providerId));
  });
}

