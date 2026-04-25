import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  loading?: boolean;
}

const variants = {
  primary: 'bg-accent text-white hover:bg-accent-dim font-medium shadow-none',
  secondary:
    'bg-white text-slate-700 hover:bg-violet-50 border border-violet-100 dark:bg-white/[0.04] dark:text-violet-100 dark:hover:bg-white/[0.08] dark:border-violet-400/10',
  danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/15 dark:border-red-400/15',
  ghost:
    'text-slate-500 dark:text-violet-200/60 hover:bg-violet-50 dark:hover:bg-white/[0.06] hover:text-slate-800 dark:hover:text-white',
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-6 py-2.5 text-sm rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  loading,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none',
        'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
