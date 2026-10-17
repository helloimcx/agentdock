import { InboxIcon } from 'lucide-react';
import type { ElementType } from 'react';

interface EmptyStateProps {
  message: string;
  icon?: ElementType<{ size?: number; strokeWidth?: number; className?: string }>;
}

export function EmptyState({ message, icon: Icon = InboxIcon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/70 py-12 text-muted-foreground">
      <Icon size={36} strokeWidth={1.5} className="mb-3 opacity-80" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
