import { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Layers,
  FileCode,
  FileText,
  Image as ImageIcon,
  Code2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import type { AgentTaskArtifact } from '@cc/superai-contracts';
import { cn } from '@/lib/utils';
import { Badge, Button } from '@/components/ui';
import { ArtifactViewer } from './ArtifactViewer';

export interface ArtifactViewerDrawerProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  artifacts: AgentTaskArtifact[];
  initialArtifactId?: string;
  title?: string;
}

export function ArtifactViewerDrawer({
  open,
  onClose,
  taskId,
  artifacts,
  initialArtifactId,
  title = 'Agent 交付产物 Artifacts',
}: ArtifactViewerDrawerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialArtifactId || null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (artifacts.length > 0) {
      if (initialArtifactId && artifacts.some((a) => a.id === initialArtifactId)) {
        setSelectedId(initialArtifactId);
      } else if (!selectedId || !artifacts.some((a) => a.id === selectedId)) {
        setSelectedId(artifacts[0]?.id || null);
      }
    } else {
      setSelectedId(null);
    }
  }, [artifacts, initialArtifactId, selectedId]);

  if (!open) return null;

  const currentArtifact = artifacts.find((a) => a.id === selectedId) || artifacts[0];

  const getArtifactIcon = (kind?: string) => {
    switch (kind) {
      case 'html':
        return <Sparkles className="h-4 w-4 text-indigo-500 shrink-0" />;
      case 'image':
        return <ImageIcon className="h-4 w-4 text-emerald-500 shrink-0" />;
      case 'diff':
        return <Code2 className="h-4 w-4 text-amber-500 shrink-0" />;
      case 'markdown':
        return <FileText className="h-4 w-4 text-primary shrink-0" />;
      default:
        return <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-10">
        <div
          className={cn(
            'flex h-full flex-col border-l bg-background p-6 shadow-2xl transition-all duration-200',
            isFullscreen ? 'w-screen max-w-6xl' : 'w-screen max-w-3xl'
          )}
        >
          {/* Header */}
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
                  共 {artifacts.length} 个交付工件
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsFullscreen((prev) => !prev)}
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

          {/* Artifact Selector Tabs (when multiple artifacts exist) */}
          {artifacts.length > 1 ? (
            <div className="mt-4 flex gap-1.5 overflow-x-auto border-b pb-2.5 [scrollbar-gutter:stable]">
              {artifacts.map((art) => {
                const isSelected = art.id === currentArtifact?.id;
                return (
                  <button
                    key={art.id}
                    onClick={() => setSelectedId(art.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors shrink-0',
                      isSelected
                        ? 'bg-primary/10 text-primary border border-primary/20 shadow-xs'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {getArtifactIcon(art.kind)}
                    <span className="truncate max-w-[140px]">{art.title}</span>
                    <Badge variant={isSelected ? 'success' : 'outline'} className="text-[10px] px-1 py-0 h-4">
                      {art.kind || 'file'}
                    </Badge>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Main Viewer Body */}
          <div className="mt-4 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            {currentArtifact ? (
              <ArtifactViewer taskId={taskId} artifact={currentArtifact} />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center text-muted-foreground">
                <Layers className="h-10 w-10 opacity-20 mb-2" />
                <p className="text-sm">暂无生成的 Artifact 产物</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Agent 执行期间生成的 HTML 图表、报告或补丁将自动展示在此处
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
