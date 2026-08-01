import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// ja（フォールバック言語・主要ユーザー）は同梱し、他言語は選択時に動的読込する。
// 5言語すべてを初期バンドルに同梱すると約440KBになるため、
// 使う言語だけを読み込んで初期表示を軽くする（バンドル最適化）。
import ja from "@/locales/ja.json";
import { BRAND } from "@/lib/brand";
import { VERTICAL_OVERLAYS } from "@/locales/vertical";

export const SUPPORTED_LANGUAGES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LAZY_LOCALES: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("@/locales/en.json"),
  ko: () => import("@/locales/ko.json"),
  "zh-CN": () => import("@/locales/zh-CN.json"),
  "zh-TW": () => import("@/locales/zh-TW.json"),
};

/**
 * 業種語彙のオーバーレイを base のロケールへ深いマージで重ねる。
 * 兄弟アプリ（業種特化版）が「ジム→サロン」等の語彙だけを差し替えるための口。
 * GymBoard 本体ではオーバーレイが空なので何も起きない。
 * 詳細は src/locales/vertical.ts のコメント参照。
 */
function applyVerticalOverlay(lng: string): void {
  const overlay = VERTICAL_OVERLAYS[lng as SupportedLanguage];
  if (!overlay || Object.keys(overlay).length === 0) return;
  // deep=true / overwrite=true: 書いたキーだけを上書きし、他は base のまま残す
  i18n.addResourceBundle(lng, "translation", overlay, true, true);
}

/**
 * 指定言語のロケールを読み込んで登録する。
 * 戻り値: 読込不要（ja・登録済み・未対応言語）または成功なら true、読込失敗なら false。
 * 失敗時も例外は投げず、ja フォールバック表示のまま継続できる。
 */
export async function loadLocale(lng: string): Promise<boolean> {
  const loader = LAZY_LOCALES[lng];
  if (!loader || i18n.hasResourceBundle(lng, "translation")) return true;
  try {
    const mod = await loader();
    i18n.addResourceBundle(lng, "translation", mod.default, true, true);
    // base を載せた「後」に重ねる。逆順だと base で上書きされて消える。
    applyVerticalOverlay(lng);
    return true;
  } catch (e) {
    console.warn(`[i18n] locale load failed: ${lng}`, e);
    return false;
  }
}

/**
 * 言語を切り替える（必要ならロケールを先に読み込む）。UI からはこれを使う。
 * ロケールの読込に失敗した場合は言語を切り替えず false を返す
 * （「UIは日本語のまま・内部状態だけ英語」という不整合を作らない）。
 */
export async function changeLanguage(lng: string): Promise<boolean> {
  const ok = await loadLocale(lng);
  if (!ok) return false;
  await i18n.changeLanguage(lng);
  return true;
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
      interpolation: {
        escapeValue: false,
        // 製品名はロケールJSONに書かず、ここから注入する。
        // こうすることで src/locales/*.json に製品固有の文字列が一切入らず、
        // 兄弟アプリ（業種特化版）のフォークでロケールファイルがバイト一致する
        // ＝ upstream からの merge が永久に衝突しない（mem/ops/vertical-fork.md）。
        //
        // 変数を言語別ではなく「表記別」にしているのは defaultVariables が全言語共通のため。
        // 日本語表記を使うか英字表記を使うかは、各ロケールJSONがどちらの変数を書くかで選ぶ。
        defaultVariables: {
          brandJa: BRAND.ja,
          brandEn: BRAND.en,
          brandApp: BRAND.app,
        },
      },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "i18nextLng",
      },
      returnNull: false,
    });

  // 起動時に ja 以外が保存されていたら、そのロケールを読み込み次第すぐ再適用する
  // （読込までの一瞬は ja フォールバックで表示される）。
  // 注意: resolvedLanguage は「バンドルが存在する言語」に解決されるため、
  // この時点では常に ja になる。検出された言語そのもの（i18n.language）を使うこと。
  const initial = i18n.language;
  if (initial && initial !== "ja" && LAZY_LOCALES[initial]) {
    void loadLocale(initial).then((ok) => {
      if (ok) i18n.changeLanguage(initial);
    });
  }
}

// ja は init の resources で同梱しているので、ここで業種語彙を重ねる
// （他言語は loadLocale の中で base を載せた直後に重ねている）。
//
// 初期化ガード（if (!i18n.isInitialized)）の**外**に置いているのは、
// i18next のインスタンスが別経路で先に初期化されていた場合でも語彙を必ず適用するため。
// 中に入れると「先に誰かが初期化していたら業種語彙が当たらない」という、
// 気づきにくい取りこぼしになる。addResourceBundle は冪等なので何度呼んでも安全。
applyVerticalOverlay("ja");

export default i18n;
