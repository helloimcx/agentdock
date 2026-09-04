import { X, Layers, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui';

export interface ArtifactDrawerHeaderProps {
  title: string;
  count: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function ArtifactDrawerHeader({
  title,
  count,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}: ArtifactDrawerHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b pb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Layers className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground truncate">
            {title}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            共 {count} 个交付工件
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleFullscreen}
          className="h-8 w-8 p-0"
          title={isFullscreen ? '还原窗口' : '全屏展开'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-8 w-8 p-0"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
