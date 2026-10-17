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
        'border border-black/[0.08] bg-white/62 shadow-[0_1px_1px_rgba(0,0,0,0.04)] backdrop-blur-2xl',
        'dark:border-white/[0.07] dark:bg-white/[0.06] dark:shadow-none',
        hover &&
          'cursor-pointer hover:border-black/[0.12] hover:bg-white/76 hover:shadow-[0_10px_26px_rgba(0,0,0,0.07)] dark:hover:border-white/[0.10] dark:hover:bg-white/[0.09] dark:hover:shadow-none',
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
