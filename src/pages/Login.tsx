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
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,#f3e8ff_0,#faf5ff_38%,#ffffff_72%)] p-4 dark:bg-[radial-gradient(circle_at_top,#2e1065_0,#12051f_42%,#05020a_78%)]">
      {/* Top right controls */}
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <div className="flex bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {languages.map(l => (
            <button
              key={l.code}
              onClick={() => { i18n.changeLanguage(l.code); localStorage.setItem('cc_lang', l.code); }}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                i18n.language === l.code
                  ? 'bg-accent/20 text-accent'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setTheme(nextTheme[theme])}
          className="p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <ThemeIcon size={16} />
        </button>
      </div>

      <div className="w-full max-w-md animate-fade-in">
        <div className="bg-white/90 dark:bg-[#0c0614]/92 backdrop-blur-xl border border-violet-100/80 dark:border-violet-400/15 rounded-2xl shadow-2xl shadow-violet-950/10 dark:shadow-black/40 p-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <BrandLogo markClassName="h-14 w-14 drop-shadow-[0_14px_28px_rgba(88,28,135,0.22)]" />
          </div>
          
          <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-1">{t('login.title')}</h1>
          <p className="text-sm text-center text-gray-500 dark:text-gray-400 mb-3">{t('login.subtitle')}</p>
          <div className="mb-8 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/60 px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
            {desktop
              ? 'AgentDock 桌面模式会自动连接到本地托管运行时。'
              : 'Browser mode requires a reachable API endpoint. Enter the server URL and access token.'}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg px-4 py-3 mb-4">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('login.token')}</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="mgmt-secret-xxx"
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/50 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors placeholder:text-gray-400"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('login.serverUrl')} <span className="text-gray-400 font-normal">({t('common.optional')})</span>
              </label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:9820"
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/50 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors placeholder:text-gray-400"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !token.trim() || (web && !serverUrl.trim())}
              className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold text-sm hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_-6px_rgba(139,92,246,0.55)]"
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
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
