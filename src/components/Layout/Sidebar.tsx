import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sun,
  Moon,
  Monitor,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Languages,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getRuntimeProvider, useRuntimeFeatureSupport } from '@/app/runtime';
import { useThemeStore } from '@/store/theme';
import { useAuthStore } from '@/store/auth';
import { useState } from 'react';
import { rendererUiContributions } from '@/app/ui-contributions';
import { BrandLogo } from '@/components/BrandLogo';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
];

const navGroups = [
  { label: 'Core', ids: ['dashboard', 'chat', 'workspace', 'projects', 'sessions'] },
  { label: 'Knowledge', ids: ['knowledge', 'cron'] },
  { label: 'System', ids: ['system'] },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useThemeStore();
  const logout = useAuthStore((s) => s.logout);
  const desktopManaged = useAuthStore((s) => s.desktopManaged);
  const features = useRuntimeFeatureSupport();
  const runtimeProvider = getRuntimeProvider();
  const [collapsed, setCollapsed] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const changeLang = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem('cc_lang', code);
    setLangOpen(false);
  };

  const themeIcons = { light: Sun, dark: Moon, system: Monitor };
  const nextTheme = { light: 'dark' as const, dark: 'system' as const, system: 'light' as const };
  const ThemeIcon = themeIcons[theme];

  const visibleNavItems = rendererUiContributions
    .listNavItems()
    .filter((item) => item.visible?.({ desktopManaged, features }) ?? true);

  return (
    <aside
      className={cn(
        'h-screen flex flex-col border-r transition-all duration-300 ease-out',
        'bg-background/85 backdrop-blur-xl',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-4 h-16 border-b transition-colors',
          'border-border'
        )}
      >
        <BrandLogo showWordmark={!collapsed} />
      </div>

      <nav className="flex-1 py-4 space-y-5 px-2 overflow-y-auto">
        {navGroups.map((group) => {
          const items = visibleNavItems.filter((item) => group.ids.includes(item.id));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {group.label}
                </p>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                const labelKey = item.resolveLabelKey?.({ desktopManaged, features, runtimeProvider }) || item.labelKey;
                return (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200',
                        isActive
                          ? 'bg-primary/10 text-foreground ring-1 ring-primary/25'
                          : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
                      )
                    }
                  >
                    <Icon size={20} className="shrink-0" />
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
          'border-t p-2 space-y-1',
          'border-border'
        )}
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => setLangOpen(!langOpen)}
            className={cn(
              'flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm transition-all duration-200',
              'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
            )}
          >
            <Languages size={20} className="shrink-0" />
            {!collapsed && (
              <span>{languages.find((l) => l.code === i18n.language)?.label || 'English'}</span>
            )}
          </button>
          {langOpen && (
            <div
              className={cn(
                'absolute bottom-full left-0 mb-1 w-48 rounded-xl py-1 z-50 overflow-hidden',
                'bg-popover text-popover-foreground backdrop-blur-xl border shadow-xl'
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
                      : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
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
            'flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm transition-all duration-200',
            'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
          )}
        >
          <ThemeIcon size={20} className="shrink-0" />
          {!collapsed && <span>{t(`theme.${theme}`)}</span>}
        </button>

        {!desktopManaged && (
          <button
            type="button"
            onClick={logout}
            className={cn(
              'flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm transition-all duration-200',
              'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <LogOut size={20} className="shrink-0" />
            {!collapsed && <span>{t('login.logout')}</span>}
          </button>
        )}

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'flex items-center justify-center w-full px-3 py-2 rounded-xl transition-colors duration-200',
            'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
          )}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
