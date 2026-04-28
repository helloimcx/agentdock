import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const fallbackLanguage = 'en';
const languageLoaders = {
  en: () => import('./locales/en.json'),
  zh: () => import('./locales/zh.json'),
  'zh-TW': () => import('./locales/zh-TW.json'),
  ja: () => import('./locales/ja.json'),
  es: () => import('./locales/es.json'),
} as const;

export type AppLanguage = keyof typeof languageLoaders;

function isAppLanguage(language: string): language is AppLanguage {
  return language in languageLoaders;
}

function normalizeLanguage(language: string) {
  if (isAppLanguage(language)) {
    return language;
  }
  const baseLanguage = language.split('-')[0];
  return isAppLanguage(baseLanguage) ? baseLanguage : fallbackLanguage;
}

function initialLanguage() {
  const saved = localStorage.getItem('cc_lang');
  return normalizeLanguage(saved || navigator.language || fallbackLanguage);
}

async function loadLanguage(language: AppLanguage) {
  if (i18n.hasResourceBundle(language, 'translation')) {
    return;
  }
  const resources = await languageLoaders[language]();
  i18n.addResourceBundle(language, 'translation', resources.default, true, true);
}

export async function initializeI18n() {
  const language = initialLanguage();
  await Promise.all([
    loadLanguage(fallbackLanguage),
    language === fallbackLanguage ? Promise.resolve() : loadLanguage(language),
  ]);
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: fallbackLanguage,
      interpolation: { escapeValue: false },
    });
  }
}

export async function setAppLanguage(language: string) {
  const nextLanguage = normalizeLanguage(language);
  await loadLanguage(nextLanguage);
  await i18n.changeLanguage(nextLanguage);
  localStorage.setItem('cc_lang', nextLanguage);
}

export default i18n;
