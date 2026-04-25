import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getRuntimeProvider, useRuntimeFeatureSupport } from '@/app/runtime';
import { resolveRouteTitleKey } from '@/app/ui-contributions';
import { useAuthStore } from '@/store/auth';

export default function Header({ onOpenAdvanced }: { onOpenAdvanced?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [spinning, setSpinning] = useState(false);
  const desktopManaged = useAuthStore((s) => s.desktopManaged);
  const features = useRuntimeFeatureSupport();
  const { desktopChat } = features;
  const runtimeProvider = getRuntimeProvider();
  const compactDesktopChatHeader =
    pathname.startsWith('/chat') && desktopChat && runtimeProvider === 'electron';

  const titleKey = resolveRouteTitleKey(pathname, { desktopManaged, features, runtimeProvider });

  const handleRefresh = () => {
    setSpinning(true);
    window.dispatchEvent(new CustomEvent('cc:refresh'));
    setTimeout(() => setSpinning(false), 1000);
  };

  return (
    <header
      className={cn(
        compactDesktopChatHeader ? 'h-11 px-4' : 'h-14 px-6',
        'flex items-center justify-between shrink-0',
        'border-b bg-background/80 backdrop-blur-xl'
      )}
    >
      {compactDesktopChatHeader ? <div /> : (
        <h1 className="text-lg font-semibold text-foreground tracking-tight">
          {t(titleKey)}
        </h1>
      )}
      {compactDesktopChatHeader ? null : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className={cn(
              'p-2 rounded-xl transition-colors duration-200',
              'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={18} className={spinning ? 'animate-spin' : ''} />
          </button>
          {onOpenAdvanced ? (
            <button
              type="button"
              onClick={onOpenAdvanced}
              className={cn(
                'p-2 rounded-xl transition-colors duration-200',
                'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
              aria-label="Open advanced diagnostics"
            >
              <SlidersHorizontal size={18} />
            </button>
          ) : null}
        </div>
      )}
    </header>
  );
}
