import { InboxIcon } from 'lucide-react';
import type { ElementType } from 'react';

interface EmptyStateProps {
  message: string;
  icon?: ElementType<{ size?: number; strokeWidth?: number; className?: string }>;
}

export function EmptyState({ message, icon: Icon = InboxIcon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-violet-100 bg-white/60 py-12 text-slate-400 dark:border-violet-400/10 dark:bg-white/[0.02] dark:text-violet-200/45">
      <Icon size={36} strokeWidth={1.5} className="mb-3 opacity-80" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
