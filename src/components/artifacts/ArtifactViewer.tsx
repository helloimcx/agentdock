import type { AgentTaskArtifact } from '@cc/superai-contracts';
import { cn } from '@/lib/utils';
import { useArtifactContent } from './useArtifactContent';
import { ArtifactToolbar } from './ArtifactToolbar';
import { ArtifactContentBody } from './ArtifactContentBody';

export interface ArtifactViewerProps {
  taskId: string;
  artifact: AgentTaskArtifact;
  className?: string;
}

export function ArtifactViewer({ taskId, artifact, className }: ArtifactViewerProps) {
  const { data, loading, error } = useArtifactContent(taskId, artifact);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ArtifactToolbar artifact={artifact} data={data} />
      <ArtifactContentBody artifact={artifact} data={data} loading={loading} error={error} />

      {artifact.path ? (
        <div className="truncate text-[11px] text-muted-foreground font-mono">
          文件路径: {artifact.path}
        </div>
      ) : null}
    </div>
  );
}
