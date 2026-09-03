import { useState, useEffect } from 'react';
import { Layers } from 'lucide-react';
import type { AgentTaskArtifact } from '@cc/superai-contracts';
import { cn } from '@/lib/utils';
import { ArtifactViewer } from './ArtifactViewer';
import { ArtifactTabStrip } from './ArtifactTabStrip';
import { ArtifactDrawerHeader } from './ArtifactDrawerHeader';

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
          <ArtifactDrawerHeader
            title={title}
            count={artifacts.length}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
            onClose={onClose}
          />

          {artifacts.length > 1 ? (
            <ArtifactTabStrip
              artifacts={artifacts}
              selectedId={currentArtifact?.id}
              onSelect={setSelectedId}
            />
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
