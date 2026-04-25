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
        'rounded-lg p-5 text-card-foreground transition-colors duration-200 animate-float-in',
        'border border-black/10 bg-card/92 shadow-[0_1px_2px_rgba(0,0,0,0.06)] backdrop-blur-xl',
        'dark:border-white/[0.08] dark:bg-card/88 dark:shadow-none',
        hover &&
          'cursor-pointer hover:border-primary/25 hover:bg-card hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:hover:bg-card/95 dark:hover:shadow-none',
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
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p
        className={cn(
          'text-2xl font-semibold mt-1',
          accent ? 'text-primary' : 'text-foreground'
        )}
      >
        {value}
      </p>
    </Card>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col space-y-1.5 p-5', className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-base font-semibold leading-none tracking-tight', className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-5 pt-0', className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center p-5 pt-0', className)}>{children}</div>;
}
