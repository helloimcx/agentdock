import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-200/80 dark:bg-gray-700/80 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity z-10">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function MarkdownPreBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const codeElement = (children as any)?.props;
  const language = codeElement?.className?.replace(/^language-/, '') || '';
  const code = typeof codeElement?.children === 'string' ? codeElement.children.replace(/\n$/, '') : '';
  return (
    <div className="not-prose relative group my-4">
      {language && (
        <div className="absolute top-0 left-0 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-tl-lg rounded-br-lg border-b border-r border-gray-200 dark:border-gray-700 font-mono">
          {language}
        </div>
      )}
      <CopyButton code={code} />
      <pre className="overflow-x-auto rounded-lg bg-[#fafafa] dark:bg-[#0d1117] border border-gray-200 dark:border-gray-700/60 p-4 pt-8 text-[13px] leading-[1.6] font-mono" {...props}>
        {children}
      </pre>
    </div>
  );
}

export function MarkdownInlineCode({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  if (className) return <code className={className} {...props}>{children}</code>;
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-pink-600 dark:text-pink-400 text-[0.875em] font-mono border border-gray-200/60 dark:border-gray-700/40" {...props}>
      {children}
    </code>
  );
}
