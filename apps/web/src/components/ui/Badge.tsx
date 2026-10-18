import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'destructive' | 'outline' | 'info';
  className?: string;
}

const variants = {
  default: 'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
  success:
    'border-transparent bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary',
  warning:
    'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
  danger: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-red-200',
  destructive: 'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
  outline: 'text-foreground',
  info: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
