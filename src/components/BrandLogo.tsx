import { cn } from '@/lib/utils';
import { useId } from 'react';

interface BrandLogoProps {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
}

export function BrandLogo({
  className,
  markClassName,
  showWordmark = false,
}: BrandLogoProps) {
  const id = useId();
  const bgId = `${id}-bg`;
  const strokeId = `${id}-stroke`;

  return (
    <div className={cn('inline-flex items-center gap-3', className)}>
      <svg
        className={cn('h-8 w-8 shrink-0', markClassName)}
        viewBox="0 0 64 64"
        role="img"
        aria-label="AgentDock"
        fill="none"
      >
        <defs>
          <linearGradient id={bgId} x1="7" y1="5" x2="57" y2="59" gradientUnits="userSpaceOnUse">
            <stop className="[stop-color:#FFFFFF] dark:[stop-color:#3A3A3C]" />
            <stop offset="0.52" className="[stop-color:#F5F5F7] dark:[stop-color:#2C2C2E]" />
            <stop offset="1" className="[stop-color:#E5E5EA] dark:[stop-color:#1C1C1E]" />
          </linearGradient>
          <linearGradient id={strokeId} x1="18" y1="16" x2="47" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5AC8FA" />
            <stop offset="0.44" stopColor="#0A84FF" />
            <stop offset="1" stopColor="#007AFF" />
          </linearGradient>
        </defs>
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          rx="16"
          fill={`url(#${bgId})`}
          className="stroke-black/10 dark:stroke-white/10"
          strokeWidth="1.5"
        />
        <path
          d="M14.5 45L25.3 20.1C26.1 18.1 28.9 18.1 29.8 20.1L40.8 45"
          stroke={`url(#${strokeId})`}
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20.8 37.5H34.7"
          className="stroke-white dark:stroke-white"
          strokeWidth="5.25"
          strokeLinecap="round"
        />
        <path
          d="M33.8 20.2H37.4C45.1 20.2 50 25.6 50 32.5C50 39.4 45.1 44.8 37.4 44.8H33.8"
          stroke={`url(#${strokeId})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.82"
        />
        <path
          d="M34 25.5V39.5"
          className="stroke-black/70 dark:stroke-black/80"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.18"
        />
      </svg>
      {showWordmark && (
        <span className="text-sm font-semibold tracking-tight text-foreground">
          AgentDock
        </span>
      )}
    </div>
  );
}
