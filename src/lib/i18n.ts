import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// ja（フォールバック言語・主要ユーザー）は同梱し、他言語は選択時に動的読込する。
// 5言語すべてを初期バンドルに同梱すると約440KBになるため、
// 使う言語だけを読み込んで初期表示を軽くする（バンドル最適化）。
import ja from "@/locales/ja.json";

export const SUPPORTED_LANGUAGES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LAZY_LOCALES: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("@/locales/en.json"),
  ko: () => import("@/locales/ko.json"),
  "zh-CN": () => import("@/locales/zh-CN.json"),
  "zh-TW": () => import("@/locales/zh-TW.json"),
};

/**
 * 指定言語のロケールを読み込んで登録する（ja・登録済み・未対応言語は no-op）。
 * 読込失敗時は例外を投げず、ja フォールバック表示のまま継続する。
 */
export async function loadLocale(lng: string): Promise<void> {
  const loader = LAZY_LOCALES[lng];
  if (!loader || i18n.hasResourceBundle(lng, "translation")) return;
  try {
    const mod = await loader();
    i18n.addResourceBundle(lng, "translation", mod.default, true, true);
  } catch (e) {
    console.warn(`[i18n] locale load failed: ${lng}`, e);
  }
}

/** 言語を切り替える（必要ならロケールを先に読み込む）。UI からはこれを使う。 */
export async function changeLanguage(lng: string): Promise<void> {
  await loadLocale(lng);
  await i18n.changeLanguage(lng);
}

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        ja: { translation: ja },
      },
      // ja 以外は loadLocale() で後から addResourceBundle する
      partialBundledLanguages: true,
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

  // 起動時に ja 以外が保存されていたら、そのロケールを読み込み次第すぐ再適用する
  // （読込までの一瞬は ja フォールバックで表示される）。
  const initial = i18n.resolvedLanguage || i18n.language;
  if (initial && initial !== "ja" && LAZY_LOCALES[initial]) {
    void loadLocale(initial).then(() => i18n.changeLanguage(initial));
  }
}

export default i18n;
