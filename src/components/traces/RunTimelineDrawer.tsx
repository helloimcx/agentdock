import { X, Activity } from 'lucide-react';
import { RunTimelineView } from './RunTimelineView';

export interface RunTimelineDrawerProps {
  open: boolean;
  onClose: () => void;
  runId: string | null;
}

export function RunTimelineDrawer({ open, onClose, runId }: RunTimelineDrawerProps) {
  if (!open || !runId) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Overlay Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl transform border-l bg-background p-6 shadow-2xl transition-all">
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Run Trace Timeline 轨迹图
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-sm p-1.5 opacity-70 transition-opacity hover:opacity-100 hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 overflow-y-auto max-h-[calc(100vh-100px)]">
            <RunTimelineView runId={runId} />
          </div>
        </div>
      </div>
    </div>
  );
}
