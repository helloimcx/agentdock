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
  const arcId = `${id}-arc`;
  const glowId = `${id}-glow`;

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
            <stop className="[stop-color:#FFFFFF] dark:[stop-color:#140823]" />
            <stop offset="0.48" className="[stop-color:#F4EFFF] dark:[stop-color:#0A0312]" />
            <stop offset="1" className="[stop-color:#DDD6FE] dark:[stop-color:#2E1065]" />
          </linearGradient>
          <linearGradient id={strokeId} x1="18" y1="16" x2="47" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#DDD6FE" />
            <stop offset="0.38" stopColor="#A78BFA" />
            <stop offset="1" stopColor="#6D28D9" />
          </linearGradient>
          <linearGradient id={arcId} x1="36" y1="17" x2="52" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F5F3FF" />
            <stop offset="0.5" stopColor="#C4B5FD" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
          <filter id={glowId} x="8" y="8" width="50" height="50" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="9" stdDeviation="7" floodColor="#6D28D9" floodOpacity="0.24" />
          </filter>
        </defs>
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          rx="16"
          fill={`url(#${bgId})`}
          className="stroke-violet-200 dark:stroke-violet-400/20"
          strokeWidth="1.5"
        />
        <path
          d="M14.5 45L25.3 20.1C26.1 18.1 28.9 18.1 29.8 20.1L40.8 45"
          stroke={`url(#${strokeId})`}
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        />
        <path
          d="M20.8 37.5H34.7"
          className="stroke-white dark:stroke-violet-100"
          strokeWidth="5.25"
          strokeLinecap="round"
        />
        <path
          d="M33.8 20.2H37.4C45.1 20.2 50 25.6 50 32.5C50 39.4 45.1 44.8 37.4 44.8H33.8"
          stroke={`url(#${arcId})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M34 25.5V39.5"
          className="stroke-violet-950/70 dark:stroke-[#10051F]"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.26"
        />
      </svg>
      {showWordmark && (
        <span className="text-sm font-semibold tracking-tight text-violet-950 dark:text-white">
          AgentDock
        </span>
      )}
    </div>
  );
}
