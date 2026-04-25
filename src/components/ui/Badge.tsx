import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const variants = {
  default: 'bg-slate-100/90 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/[0.06]',
  success:
    'bg-violet-100/90 dark:bg-violet-900/25 text-violet-700 dark:text-violet-400 border border-violet-200/50 dark:border-violet-500/20',
  warning:
    'bg-amber-100/90 dark:bg-amber-900/25 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-500/20',
  danger:
    'bg-red-100/90 dark:bg-red-900/25 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-500/20',
  info: 'bg-blue-100/90 dark:bg-blue-900/25 text-blue-700 dark:text-blue-400 border border-blue-200/50 dark:border-blue-500/20',
};

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        variants[variant]
      )}
    >
      {children}
    </span>
  );
}
