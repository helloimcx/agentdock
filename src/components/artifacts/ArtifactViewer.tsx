import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Copy,
  Check,
  ExternalLink,
  Download,
  AlertCircle,
  Loader2,
  Code2,
  Sparkles,
} from 'lucide-react';
import { runtime as runtimeApi } from '@cc/core-sdk';
import type { AgentTaskArtifact, AgentTaskArtifactContent } from '@cc/superai-contracts';
import { cn } from '@/lib/utils';
import { Badge, Button } from '@/components/ui';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

export interface ArtifactViewerProps {
  taskId: string;
  artifact: AgentTaskArtifact;
  className?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getKindBadgeVariant(kind: string): 'info' | 'success' | 'warning' | 'secondary' | 'outline' {
  if (kind === 'html') return 'info';
  if (kind === 'markdown') return 'success';
  if (kind === 'diff') return 'warning';
  if (kind === 'image') return 'secondary';
  return 'outline';
}

function DiffRenderer({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="overflow-x-auto rounded-md border bg-muted/30 font-mono text-xs leading-5">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const isAdd = line.startsWith('+');
            const isDel = line.startsWith('-');
            const isHunk = line.startsWith('@@');

            return (
              <tr
                key={idx}
                className={cn(
                  'transition-colors',
                  isAdd && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  isDel && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                  isHunk && 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-semibold'
                )}
              >
                <td className="w-12 select-none px-2 py-0.5 text-right text-[11px] text-muted-foreground/60">
                  {idx + 1}
                </td>
                <td className="w-4 select-none px-1 text-center font-bold opacity-70">
                  {isAdd ? '+' : isDel ? '-' : ' '}
                </td>
                <td className="whitespace-pre-wrap break-all px-2 py-0.5">
                  {isAdd || isDel ? line.slice(1) : line}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HtmlRenderer({ title, content }: { title: string; content: string }) {
  return (
    <div className="relative flex h-[500px] w-full flex-col overflow-hidden rounded-lg border bg-card shadow-inner">
      <iframe
        title={title}
        srcDoc={content}
        sandbox="allow-scripts"
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}

function ImageRenderer({
  title,
  content,
  isBinary,
  mimeType,
}: {
  title: string;
  content: string;
  isBinary: boolean;
  mimeType: string;
}) {
  const imageSrc = isBinary
    ? `data:${mimeType};base64,${content}`
    : content.startsWith('http') || content.startsWith('data:')
    ? content
    : `data:${mimeType};base64,${content}`;

  return (
    <div className="flex max-h-[520px] items-center justify-center overflow-hidden rounded-lg border bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] p-4 dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px]">
      <img
        src={imageSrc}
        alt={title}
        className="max-h-[460px] max-w-full rounded object-contain shadow-md"
      />
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="max-h-[520px] overflow-y-auto rounded-lg border bg-card p-5 text-sm shadow-inner [scrollbar-gutter:stable]">
      <ChatMarkdown content={content} isUser={false} />
    </div>
  );
}

function TextRenderer({ content }: { content: string }) {
  return (
    <div className="relative max-h-[520px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5 text-foreground [scrollbar-gutter:stable]">
      <pre className="whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}

export function ArtifactViewer({ taskId, artifact, className }: ArtifactViewerProps) {
  const [data, setData] = useState<AgentTaskArtifactContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await runtimeApi.getTaskArtifactContent(taskId, artifact.id);
      setData(res);
    } catch (err) {
      if (artifact.summary || artifact.metadata?.content) {
        const text = (artifact.metadata?.content as string) || artifact.summary || '';
        setData({
          id: artifact.id,
          taskId,
          title: artifact.title,
          kind: artifact.kind || 'text',
          mimeType: (artifact.metadata?.mimeType as string) || 'text/plain',
          content: text,
          isBinary: false,
          sizeBytes: text.length,
          path: artifact.path,
          url: artifact.url,
        });
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, artifact]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

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

  const handleOpenInNewWindow = useCallback(() => {
    if (!data?.content) return;
    let url = data.url;
    if (!url) {
      if (data.isBinary) {
        url = `data:${data.mimeType};base64,${data.content}`;
      } else {
        const blob = new Blob([data.content], { type: data.mimeType || 'text/html' });
        url = URL.createObjectURL(blob);
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
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

  const kind = data?.kind || artifact.kind || 'file';

  const renderContentBody = () => {
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
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          {kind === 'html' ? (
            <Sparkles className="h-4 w-4 text-indigo-500 shrink-0" />
          ) : kind === 'image' ? (
            <ImageIcon className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : kind === 'diff' ? (
            <Code2 className="h-4 w-4 text-amber-500 shrink-0" />
          ) : (
            <FileText className="h-4 w-4 text-primary shrink-0" />
          )}
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

          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenInNewWindow}
            disabled={!data?.content}
            className="h-7 text-xs px-2"
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            新窗口打开
          </Button>
        </div>
      </div>

      {renderContentBody()}

      {artifact.path ? (
        <div className="truncate text-[11px] text-muted-foreground font-mono">
          文件路径: {artifact.path}
        </div>
      ) : null}
    </div>
  );
}
