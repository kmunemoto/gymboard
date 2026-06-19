import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ja from "@/locales/ja.json";
import en from "@/locales/en.json";
import ko from "@/locales/ko.json";
import zhCN from "@/locales/zh-CN.json";
import zhTW from "@/locales/zh-TW.json";

export const SUPPORTED_LANGUAGES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
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
        "zh-CN": { translation: zhCN },
        "zh-TW": { translation: zhTW },
      },
      supportedLngs: [...SUPPORTED_LANGUAGES],
      fallbackLng: "ja",
      nonExplicitSupportedLngs: false,
      load: "currentOnly",
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
