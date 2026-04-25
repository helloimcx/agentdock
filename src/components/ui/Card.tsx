import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl p-5 transition-colors duration-200 animate-float-in',
        'bg-white/90 border border-violet-100/90 shadow-sm shadow-violet-950/[0.03]',
        'dark:bg-white/[0.035] dark:border-violet-400/[0.10] dark:shadow-none',
        hover &&
          'hover:border-violet-200 hover:bg-white cursor-pointer dark:hover:border-violet-300/20 dark:hover:bg-white/[0.055]',
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <Card>
      <p className="text-xs font-medium text-slate-500 dark:text-violet-200/55 uppercase tracking-wide">
        {label}
      </p>
      <p
        className={cn(
          'text-2xl font-semibold mt-1',
          accent ? 'text-accent' : 'text-slate-950 dark:text-white'
        )}
      >
        {value}
      </p>
    </Card>
  );
}
