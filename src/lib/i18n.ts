import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ja from "@/locales/ja.json";
import en from "@/locales/en.json";
import ko from "@/locales/ko.json";

export const SUPPORTED_LANGUAGES = ["ja", "en", "ko"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        ja: { translation: ja },
        en: { translation: en },
        ko: { translation: ko },
      },
      supportedLngs: [...SUPPORTED_LANGUAGES],
      fallbackLng: "ja",
      nonExplicitSupportedLngs: true,
      load: "languageOnly",
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "i18nextLng",
      },
      returnNull: false,
    });
}

export default i18n;
