import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap, AlertCircle, Languages, Sun, Moon, Monitor } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { api } from '@/api/client';
import { getStatus } from '@/api/status';
import { isDesktopApp, isWebApp } from '@/app/runtime';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, Card, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中' },
  { code: 'zh-TW', label: '繁' },
  { code: 'ja', label: '日' },
  { code: 'es', label: 'ES' },
];

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const { theme, setTheme } = useThemeStore();
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const desktop = isDesktopApp();
  const web = isWebApp();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || (web && !serverUrl.trim())) return;
    setLoading(true);
    setError('');
    try {
      if (serverUrl.trim()) {
        api.setBaseUrl(serverUrl.trim());
      }
      api.setToken(token.trim());
      await getStatus();
      login(token.trim(), serverUrl.trim());
      if (desktop) {
        window.location.hash = '#/';
      } else {
        navigate('/', { replace: true });
      }
    } catch {
      setError(t('login.invalidToken'));
      api.setToken('');
      api.setBaseUrl('');
    } finally {
      setLoading(false);
    }
  };

  const themeIcons = { light: Sun, dark: Moon, system: Monitor };
  const nextTheme: Record<string, 'light' | 'dark' | 'system'> = { light: 'dark', dark: 'system', system: 'light' };
  const ThemeIcon = themeIcons[theme];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,hsl(var(--secondary))_0,hsl(var(--background))_42%,hsl(var(--background))_78%)] p-4">
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border bg-card/80 backdrop-blur">
          {languages.map(l => (
            <button
              key={l.code}
              onClick={() => { i18n.changeLanguage(l.code); localStorage.setItem('cc_lang', l.code); }}
              className={cn('px-2.5 py-1.5 text-xs font-medium transition-colors',
                i18n.language === l.code
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setTheme(nextTheme[theme])}
          aria-label={t(`theme.${theme}`)}
        >
          <ThemeIcon size={16} />
        </Button>
      </div>

      <div className="w-full max-w-md animate-fade-in">
        <Card className="p-8 shadow-2xl shadow-primary/10">
          <div className="flex justify-center mb-6">
            <BrandLogo markClassName="h-14 w-14 drop-shadow-[0_14px_28px_rgba(0,122,255,0.22)]" />
          </div>
          
          <h1 className="text-2xl font-bold text-center text-foreground mb-1">{t('login.title')}</h1>
          <p className="text-sm text-center text-muted-foreground mb-3">{t('login.subtitle')}</p>
          <div className="mb-8 rounded-lg border bg-muted px-4 py-3 text-xs text-muted-foreground">
            {desktop
              ? 'AgentDock 桌面模式会自动连接到本地托管运行时。'
              : 'Browser mode requires a reachable API endpoint. Enter the server URL and access token.'}
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive dark:text-red-200">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('login.token')}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="mgmt-secret-xxx"
              autoFocus
            />
            <Input
              label={`${t('login.serverUrl')} (${t('common.optional')})`}
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:9820"
            />
            <Button
              type="submit"
              disabled={loading || !token.trim() || (web && !serverUrl.trim())}
              className="w-full shadow-[0_0_20px_-6px_hsl(var(--primary)/0.55)]"
            >
              {loading ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <Zap size={16} />
              )}
              {t('login.connect')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
