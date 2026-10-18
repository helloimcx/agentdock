import { useState, useCallback } from 'react';
import { Copy, Check, Download, ExternalLink } from 'lucide-react';
import type { AgentTaskArtifact, AgentTaskArtifactContent } from '@cc/superai-contracts';
import { Badge, Button } from '@/components/ui';
import { formatBytes, getKindBadgeVariant, getArtifactKindIcon } from './ArtifactRenderers';

export interface ArtifactToolbarProps {
  artifact: AgentTaskArtifact;
  data: AgentTaskArtifactContent | null;
}

export function ArtifactToolbar({ artifact, data }: ArtifactToolbarProps) {
  const [copied, setCopied] = useState(false);
  const kind = data?.kind || artifact.kind || 'file';
  const externalUrl = data?.url && /^https?:\/\//i.test(data.url) ? data.url : null;

  const handleCopy = useCallback(async () => {
    if (!data?.content) return;
    try {
      await navigator.clipboard.writeText(data.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy artifact content', err);
    }
  }, [data]);

  const handleDownload = useCallback(() => {
    if (!data?.content) return;
    const a = document.createElement('a');
    if (data.isBinary) {
      a.href = `data:${data.mimeType};base64,${data.content}`;
    } else {
      const blob = new Blob([data.content], { type: data.mimeType || 'text/plain' });
      a.href = URL.createObjectURL(blob);
    }
    a.download = artifact.title || 'artifact';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [data, artifact]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        {getArtifactKindIcon(kind)}
        <span className="truncate font-semibold text-sm text-foreground">{artifact.title}</span>
        <Badge variant={getKindBadgeVariant(kind)}>{kind.toUpperCase()}</Badge>
        {data?.sizeBytes ? (
          <span className="text-[11px] text-muted-foreground">({formatBytes(data.sizeBytes)})</span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          disabled={!data?.content || data.isBinary}
          className="h-7 text-xs px-2"
        >
          {copied ? <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制'}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleDownload}
          disabled={!data?.content}
          className="h-7 text-xs px-2"
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          下载
        </Button>

        {externalUrl ? (
          <Button size="sm" variant="outline" asChild className="h-7 text-xs px-2">
            <a href={externalUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              新窗口打开
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
