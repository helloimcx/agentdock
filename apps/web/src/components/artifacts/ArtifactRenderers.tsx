import type { ReactNode } from 'react';
import { FileText, Image as ImageIcon, Code2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

// Agent-produced HTML is untrusted: block every network channel from inside the
// sandboxed preview (the opaque origin must not reach the local API).
const HTML_PREVIEW_CSP_META = '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">';

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getKindBadgeVariant(kind: string): 'info' | 'success' | 'warning' | 'secondary' | 'outline' {
  if (kind === 'html') return 'info';
  if (kind === 'markdown') return 'success';
  if (kind === 'diff') return 'warning';
  if (kind === 'image') return 'secondary';
  return 'outline';
}

export function getArtifactKindIcon(kind?: string): ReactNode {
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
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

export function DiffRenderer({ content }: { content: string }) {
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

export function HtmlRenderer({ title, content }: { title: string; content: string }) {
  return (
    <div className="relative flex h-[500px] w-full flex-col overflow-hidden rounded-lg border bg-card shadow-inner">
      <iframe
        title={title}
        srcDoc={`${HTML_PREVIEW_CSP_META}${content}`}
        sandbox="allow-scripts"
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}

export function ImageRenderer({
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

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="max-h-[520px] overflow-y-auto rounded-lg border bg-card p-5 text-sm shadow-inner [scrollbar-gutter:stable]">
      <ChatMarkdown content={content} isUser={false} />
    </div>
  );
}

export function TextRenderer({ content }: { content: string }) {
  return (
    <div className="relative max-h-[520px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5 text-foreground [scrollbar-gutter:stable]">
      <pre className="whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}
