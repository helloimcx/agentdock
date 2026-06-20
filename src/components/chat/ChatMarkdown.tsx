import { lazy, Suspense } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

const HighlightedMarkdown = lazy(() =>
  import('./HighlightedMarkdown').then((module) => ({ default: module.HighlightedMarkdown })),
);

export function ChatMarkdown({ content, isUser }: { content: string; isUser: boolean }) {
  if (isUser) {
    return (
      <div className="prose prose-sm max-w-none text-inherit [&_*]:text-inherit [&_a]:underline [&_code]:border [&_code]:border-black/10 [&_code]:bg-black/10 [&_code]:text-inherit dark:[&_code]:border-white/10 dark:[&_code]:bg-white/12 [&>p]:my-0.5 [&_li]:my-0">
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'prose max-w-none dark:prose-invert',
        'prose-headings:font-semibold prose-headings:tracking-tight',
        'prose-h1:text-xl prose-h1:mt-5 prose-h1:mb-3 prose-h1:pb-1.5 prose-h1:border-b prose-h1:border-gray-200 dark:prose-h1:border-gray-700',
        'prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2',
        'prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2',
        'prose-p:my-2.5 prose-p:leading-relaxed',
        'prose-li:my-0.5',
        'prose-ul:my-2 prose-ol:my-2',
        'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
        'prose-strong:text-gray-900 dark:prose-strong:text-white prose-strong:font-semibold',
        'prose-blockquote:border-l-[3px] prose-blockquote:border-accent/40 prose-blockquote:bg-accent/[0.03] prose-blockquote:rounded-r-lg prose-blockquote:py-0.5 prose-blockquote:px-4 prose-blockquote:my-3 prose-blockquote:not-italic prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-300',
        'prose-hr:my-5 prose-hr:border-gray-200 dark:prose-hr:border-gray-700',
        'prose-table:text-sm prose-th:bg-gray-50 dark:prose-th:bg-gray-800 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:border-gray-200 dark:prose-th:border-gray-700 prose-td:border-gray-200 dark:prose-td:border-gray-700',
        'prose-img:rounded-lg prose-img:shadow-sm',
      )}
    >
      {/```/.test(content) ? (
        <Suspense fallback={<Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>}>
          <HighlightedMarkdown content={content} />
        </Suspense>
      ) : (
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      )}
    </div>
  );
}
