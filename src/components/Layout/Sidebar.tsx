import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sun,
  Moon,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Languages,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRuntimeFeatureSupport } from '@/app/runtime';
import { useThemeStore } from '@/store/theme';
import { useState } from 'react';
import { rendererUiContributions } from '@/app/ui-contributions';
import { BrandLogo } from '@/components/BrandLogo';
import { setAppLanguage } from '@/i18n';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
];

const navGroups = [
  { label: 'Core', ids: ['dashboard', 'chat', 'workspace', 'projects', 'sessions'] },
  { label: 'Knowledge', ids: ['knowledge', 'cron', 'monitors'] },
  { label: 'System', ids: ['system'] },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useThemeStore();
  const features = useRuntimeFeatureSupport();
  const [collapsed, setCollapsed] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const changeLang = (code: string) => {
    void setAppLanguage(code);
    setLangOpen(false);
  };

  const themeIcons = { light: Sun, dark: Moon, system: Monitor };
  const nextTheme = { light: 'dark' as const, dark: 'system' as const, system: 'light' as const };
  const ThemeIcon = themeIcons[theme];

  const visibleNavItems = rendererUiContributions
    .listNavItems()
    .filter((item) => item.visible?.({ features }) ?? true);

  const navItemNodes = visibleNavItems.map((item) => {
    const Icon = item.icon;
    const labelKey = item.resolveLabelKey?.({ features }) || item.labelKey;
    return { ...item, Icon, labelKey };
  });
  const hideMobileNav = pathname.startsWith('/chat');

  return (
    <>
    <aside
      className={cn(
        'relative hidden h-[100dvh] flex-col overflow-hidden border-r transition-all duration-300 ease-out md:flex',
        'border-white/55 bg-white/24 shadow-[inset_-1px_0_0_rgba(255,255,255,0.36)] backdrop-blur-[34px] supports-[backdrop-filter]:bg-white/18',
        'dark:border-white/[0.10] dark:bg-[#1c1c1e]/34 dark:shadow-[inset_-1px_0_0_rgba(255,255,255,0.08)] dark:supports-[backdrop-filter]:bg-[#1c1c1e]/26',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55),rgba(255,255,255,0.18)_48%,rgba(255,255,255,0.08))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025)_52%,rgba(255,255,255,0.015))]"
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative flex h-[5.25rem] items-center gap-3 px-4 pt-7 transition-colors'
        )}
      >
        <BrandLogo showWordmark={!collapsed} />
      </div>

      <nav className="relative flex-1 py-3 space-y-4 px-2 overflow-y-auto">
        {navGroups.map((group) => {
          const items = visibleNavItems.filter((item) => group.ids.includes(item.id));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                  {group.label}
                </p>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                const labelKey = item.resolveLabelKey?.({ features }) || item.labelKey;
                return (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'bg-black/[0.07] text-foreground dark:bg-white/[0.10]'
                          : 'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]'
                      )
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    {!collapsed && <span>{t(labelKey)}</span>}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          'relative border-t p-2 space-y-1',
          'border-black/10 dark:border-white/[0.08]'
        )}
      >
        {!collapsed && (
          <div className="px-3 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground/75">
            AgentDock v{__APP_VERSION__}
          </div>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setLangOpen(!langOpen)}
            className={cn(
              'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors duration-200',
              'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <Languages size={18} className="shrink-0" />
            {!collapsed && (
              <span>{languages.find((l) => l.code === i18n.language)?.label || 'English'}</span>
            )}
          </button>
          {langOpen && (
            <div
              className={cn(
                'absolute bottom-full left-0 mb-1 w-48 rounded-xl py-1 z-50 overflow-hidden',
                'border border-black/10 bg-white/90 text-popover-foreground shadow-[0_18px_40px_rgba(0,0,0,0.12)] backdrop-blur-2xl',
                'dark:border-white/[0.08] dark:bg-[#2c2c2e]/90'
              )}
            >
              {languages.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => changeLang(l.code)}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm transition-colors duration-150',
                    i18n.language === l.code
                      ? 'text-primary font-medium bg-primary/10'
                      : 'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]'
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setTheme(nextTheme[theme])}
          className={cn(
            'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors duration-200',
            'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          <ThemeIcon size={18} className="shrink-0" />
          {!collapsed && <span>{t(`theme.${theme}`)}</span>}
        </button>

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'flex items-center justify-center w-full px-3 py-2 rounded-lg transition-colors duration-200',
            'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
    {hideMobileNav ? null : (
      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 border-t px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 md:hidden',
          'border-black/10 bg-white/88 shadow-[0_-12px_32px_rgba(15,23,42,0.10)] backdrop-blur-2xl',
          'dark:border-white/[0.08] dark:bg-[#111113]/88 dark:shadow-[0_-16px_42px_rgba(0,0,0,0.34)]',
        )}
        aria-label="Primary navigation"
      >
        <div className="flex items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItemNodes.map(({ id, path, end, Icon, labelKey }) => (
            <NavLink
              key={id}
              to={path}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-w-[4.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]',
                )
              }
            >
              <Icon size={18} className="shrink-0" />
              <span className="max-w-[4.25rem] truncate">{t(labelKey)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    )}
    </>
  );
}
