import type { AgentTaskArtifact } from '@cc/superai-contracts';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { getArtifactKindIcon } from './ArtifactRenderers';

export interface ArtifactTabStripProps {
  artifacts: AgentTaskArtifact[];
  selectedId?: string;
  onSelect: (artifactId: string) => void;
}

export function ArtifactTabStrip({ artifacts, selectedId, onSelect }: ArtifactTabStripProps) {
  return (
    <div className="mt-4 flex gap-1.5 overflow-x-auto border-b pb-2.5 [scrollbar-gutter:stable]">
      {artifacts.map((art) => {
        const isSelected = art.id === selectedId;
        return (
          <button
            key={art.id}
            onClick={() => onSelect(art.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors shrink-0',
              isSelected
                ? 'bg-primary/10 text-primary border border-primary/20 shadow-xs'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {getArtifactKindIcon(art.kind)}
            <span className="truncate max-w-[140px]">{art.title}</span>
            <Badge variant={isSelected ? 'success' : 'outline'} className="text-[10px] px-1 py-0 h-4">
              {art.kind || 'file'}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
