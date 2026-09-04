import { AlertCircle, Loader2 } from 'lucide-react';
import type { AgentTaskArtifact, AgentTaskArtifactContent } from '@cc/superai-contracts';
import {
  DiffRenderer,
  HtmlRenderer,
  ImageRenderer,
  MarkdownRenderer,
  TextRenderer,
} from './ArtifactRenderers';

export interface ArtifactContentBodyProps {
  artifact: AgentTaskArtifact;
  data: AgentTaskArtifactContent | null;
  loading: boolean;
  error: string | null;
}

function ArtifactKindView({ artifact, data }: { artifact: AgentTaskArtifact; data: AgentTaskArtifactContent }) {
  const kind = data.kind || artifact.kind || 'file';
  if (kind === 'html' || data.mimeType === 'text/html') {
    return <HtmlRenderer title={artifact.title} content={data.content} />;
  }
  if (kind === 'markdown' || data.mimeType === 'text/markdown') {
    return <MarkdownRenderer content={data.content} />;
  }
  if (kind === 'diff' || data.mimeType === 'text/x-diff') {
    return <DiffRenderer content={data.content} />;
  }
  if (kind === 'image' || data.isBinary || data.mimeType.startsWith('image/')) {
    return (
      <ImageRenderer
        title={artifact.title}
        content={data.content}
        isBinary={data.isBinary}
        mimeType={data.mimeType}
      />
    );
  }
  return <TextRenderer content={data.content} />;
}

export function ArtifactContentBody({ artifact, data, loading, error }: ArtifactContentBodyProps) {
  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>正在加载工件内容...</span>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-xs text-rose-600 dark:text-rose-400">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          <span>工件内容读取失败</span>
        </div>
        <p className="mt-1 text-[11px] opacity-90">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="py-12 text-center text-xs text-muted-foreground">暂无工件内容</div>;
  }
  return <ArtifactKindView artifact={artifact} data={data} />;
}
