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
  // 注意: resolvedLanguage は「バンドルが存在する言語」に解決されるため、
  // この時点では常に ja になる。検出された言語そのもの（i18n.language）を使うこと。
  const initial = i18n.language;
  if (initial && initial !== "ja" && LAZY_LOCALES[initial]) {
    void loadLocale(initial).then((ok) => {
      if (ok) i18n.changeLanguage(initial);
    });
  }
}

/**
 * 業種ごとの用語オーバーレイを ja に重ねる。
 *
 * 接骨院では「お客様」「ジム」「トレーナー」ではなく「患者」「院」「施術者」と呼ぶ。
 * ja.json 本体を書き換えると既存のジム（Salute御所南ほか）の表示が変わってしまうため、
 * **差分キーだけを持つ別ファイルを実行時に重ねる**（deep=true / overwrite=true）。
 * ja.json は1文字も変わらないので、既存テナントの1900キー超は完全に不変。
 *
 * テナントが解決されるまでは業種が分からないため、ごく短い間だけジム向けの文言が
 * 見えうる（各画面のローディング表示でほぼ隠れるが、完全には消せない）。
 * オーバーレイを画面描画より先に確定させるには tenant の先読みが要るので、
 * そこまでの複雑さは今は引き受けていない。
 *
 * 現状は ja のみ。接骨院版は国内向けで多言語を出す予定が無く、
 * 医療系の海外配信はストア側の申告義務の射程に入りうるため、意図的に ja 限定にしている。
 */
let appliedOverlay: string | null = null;

export async function applyTerminologyOverlay(overlay: "clinic" | null): Promise<void> {
  if (overlay === appliedOverlay) return;
  // 一度重ねたオーバーレイは i18next 側から綺麗に剥がせない（deep merge のため）。
  // 業種はテナント単位で変わらず、テナントの切替時は必ずリロードが挟まるので、
  // 「重ねるだけ・剥がさない」で運用する。null への戻しは何もしない。
  if (!overlay) return;
  try {
    const mod = await import("@/locales/ja.clinic.json");
    const { _comment, ...bundle } = mod.default as Record<string, unknown>;
    i18n.addResourceBundle("ja", "translation", bundle, true, true);
    appliedOverlay = overlay;
  } catch (e) {
    console.warn(`[i18n] terminology overlay load failed: ${overlay}`, e);
  }
}

export default i18n;
