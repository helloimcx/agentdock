import type {
  StandardPackInfo,
  StandardPackMetadata,
  InstallStandardPackInput,
  StandardPackScanReport,
  MaterializeStandardsResult,
  DetectedTechStack,
} from '@cc/superai-contracts/standards';
import type { DesktopStandardsOptions } from '@cc/superai-contracts';
import { coreRequest, buildQuery } from './request.js';

export function listStandardPacks(options: { workspaceId?: string; workspacePath?: string } = {}) {
  const query = buildQuery({
    workspaceId: options.workspaceId,
    workspacePath: options.workspacePath,
  });
  return coreRequest<{ packs: StandardPackInfo[] }>('GET', `/standards/packs${query}`);
}

export function getStandardPack(packId: string, options: { workspaceId?: string; workspacePath?: string } = {}) {
  const query = buildQuery({
    workspaceId: options.workspaceId,
    workspacePath: options.workspacePath,
  });
  return coreRequest<StandardPackMetadata>('GET', `/standards/packs/${encodeURIComponent(packId)}${query}`);
}

export function installStandardPack(input: InstallStandardPackInput & { rawContent?: string }) {
  return coreRequest<{ pack: StandardPackInfo }>('POST', '/standards/packs', input);
}

export function scanStandardPack(content: string, packId?: string) {
  return coreRequest<StandardPackScanReport>('POST', '/standards/packs/scan', { content, packId });
}

export function removeStandardPack(
  packId: string,
  options: { scope?: 'user' | 'workspace'; workspaceId?: string; workspacePath?: string } = {},
) {
  const query = buildQuery({
    scope: options.scope,
    workspaceId: options.workspaceId,
    workspacePath: options.workspacePath,
  });
  return coreRequest<{ ok: boolean; removedPackId: string }>('DELETE', `/standards/packs/${encodeURIComponent(packId)}${query}`);
}

export function getWorkspaceStandards(workspaceId: string) {
  return coreRequest<{
    workspaceId: string;
    workspacePath?: string;
    standards: DesktopStandardsOptions;
    detectedStacks: DetectedTechStack;
  }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/standards`);
}

export function updateWorkspaceStandards(workspaceId: string, standards: DesktopStandardsOptions) {
  return coreRequest<{
    ok: boolean;
    standards: DesktopStandardsOptions;
    materialized?: MaterializeStandardsResult;
  }>('PUT', `/workspaces/${encodeURIComponent(workspaceId)}/standards`, standards);
}

export function materializeWorkspaceStandards(workspaceId: string, options: { unattended?: boolean } = {}) {
  return coreRequest<MaterializeStandardsResult>(
    'POST',
    `/workspaces/${encodeURIComponent(workspaceId)}/standards/materialize`,
    options,
  );
}

export function detectWorkspaceTechStack(workspaceId: string) {
  return coreRequest<{
    workspaceId: string;
    workspacePath: string;
    detectedStacks: DetectedTechStack;
  }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/standards/detect`);
}
