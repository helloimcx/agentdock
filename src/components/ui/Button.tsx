import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'destructive' | 'danger' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'md' | 'lg' | 'icon';
  children: ReactNode;
  loading?: boolean;
  asChild?: boolean;
}

const variants = {
  default: 'bg-primary text-primary-foreground hover:bg-accent-dim',
  primary: 'bg-primary text-primary-foreground hover:bg-accent-dim',
  secondary: 'bg-black/[0.05] text-secondary-foreground hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]',
  outline: 'border border-input bg-background hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  ghost:
    'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizes = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 rounded-md px-3 text-xs',
  md: 'h-9 rounded-md px-4 py-2 text-sm',
  lg: 'h-10 rounded-md px-6 text-sm',
  icon: 'h-9 w-9',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  loading,
  asChild,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const resolvedSize = size === 'default' ? 'md' : size;
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      {...(!asChild ? { type } : {})}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-200',
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[resolvedSize],
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
    </Comp>
  );
}
