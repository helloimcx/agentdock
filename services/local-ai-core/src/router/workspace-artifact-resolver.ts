import type { AgentTask, AgentTaskArtifact, AgentTaskArtifactContent } from '@cc/superai-contracts';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute, join, sep } from 'node:path';

export const MAX_ARTIFACT_CONTENT_BYTES = 10 * 1024 * 1024;

export class ArtifactContentError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 413) {
    super(message);
    this.name = 'ArtifactContentError';
  }
}

const isInsideRoot = (candidate: string, root: string) =>
  candidate === root || candidate.startsWith(root + sep);

export function resolveArtifactContentPath(
  workspacePath: string | undefined,
  userDataPath: string | undefined,
  filePath: string,
): { realPath: string; sizeBytes: number } {
  const lexicalRoots = [
    workspacePath ? join(resolve(workspacePath), '.agentdock', 'artifacts') : null,
    userDataPath ? join(resolve(userDataPath), '.agentdock', 'artifacts') : null,
  ].filter((root): root is string => Boolean(root));
  const resolvedRoots: string[] = [];
  for (const root of lexicalRoots) {
    try {
      resolvedRoots.push(realpathSync(root));
    } catch {
      // Artifacts root may not exist yet; the lexical boundary still applies.
    }
  }

  let targetPath = filePath;
  if (!isAbsolute(targetPath)) {
    if (!workspacePath) {
      throw new ArtifactContentError('Cannot resolve relative artifact path without a workspace root.', 400);
    }
    targetPath = resolve(workspacePath, targetPath);
  } else {
    targetPath = resolve(targetPath);
  }

  if (!lexicalRoots.some((root) => isInsideRoot(targetPath, root))) {
    throw new ArtifactContentError('Artifact path is outside the allowed artifacts directory.', 403);
  }

  if (!existsSync(targetPath)) {
    throw new ArtifactContentError('Artifact file not found.', 404);
  }

  let realPath: string;
  try {
    realPath = realpathSync(targetPath);
  } catch {
    throw new ArtifactContentError('Artifact file not found.', 404);
  }

  if (!resolvedRoots.some((root) => isInsideRoot(realPath, root))) {
    throw new ArtifactContentError('Artifact path is outside the allowed artifacts directory.', 403);
  }

  const stats = statSync(realPath);
  if (stats.isDirectory()) {
    throw new ArtifactContentError('Artifact path is a directory.', 400);
  }
  if (stats.size > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new ArtifactContentError(`Artifact exceeds the maximum supported artifact size (${MAX_ARTIFACT_CONTENT_BYTES} bytes).`, 413);
  }
  return { realPath, sizeBytes: stats.size };
}

export function buildArtifactMetadataContent(task: AgentTask, artifact: AgentTaskArtifact): AgentTaskArtifactContent {
  const textContent = (artifact.metadata?.content as string) || artifact.summary || '';
  return {
    id: artifact.id,
    taskId: task.taskId,
    title: artifact.title,
    kind: artifact.kind || 'text',
    mimeType: (artifact.metadata?.mimeType as string) || 'text/plain',
    content: textContent,
    isBinary: false,
    sizeBytes: Buffer.byteLength(textContent, 'utf8'),
    url: artifact.url,
  };
}
