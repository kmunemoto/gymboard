import { format } from "date-fns";
import { ja, enUS, ko, zhCN, zhTW } from "date-fns/locale";
import type { Locale } from "date-fns";
import i18n from "@/lib/i18n";

// 画面表示用の日付ロケール対応ヘルパー。
// 中国語(簡体/繁体)は年月日表記が自然なため日本語と同形。英語・韓国語は言語別パターン。
// 注意: 通知・メッセージ本文など「送信される文面」には使わない（受信側の言語に依存しないため）。

type Variant =
  | "monthDay"
  | "monthDayDow"
  | "monthDayTime"
  | "yearMonthDay"
  | "yearMonthDayTime"
  | "yearMonth"
  | "slashMonthDayDow";

type Lang = "ja" | "en" | "ko" | "zh-CN" | "zh-TW";

const LOCALES: Record<Lang, Locale> = {
  ja,
  en: enUS,
  ko,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

const PATTERNS: Record<Variant, Record<Lang, string>> = {
  monthDay: { ja: "M月d日", en: "MMM d", ko: "M월 d일", "zh-CN": "M月d日", "zh-TW": "M月d日" },
  monthDayDow: { ja: "M月d日（E）", en: "MMM d (EEE)", ko: "M월 d일 (E)", "zh-CN": "M月d日（E）", "zh-TW": "M月d日（E）" },
  monthDayTime: { ja: "M月d日 HH:mm", en: "MMM d, HH:mm", ko: "M월 d일 HH:mm", "zh-CN": "M月d日 HH:mm", "zh-TW": "M月d日 HH:mm" },
  yearMonthDay: { ja: "yyyy年M月d日", en: "MMM d, yyyy", ko: "yyyy년 M월 d일", "zh-CN": "yyyy年M月d日", "zh-TW": "yyyy年M月d日" },
  yearMonthDayTime: { ja: "yyyy年M月d日 HH:mm", en: "MMM d, yyyy HH:mm", ko: "yyyy년 M월 d일 HH:mm", "zh-CN": "yyyy年M月d日 HH:mm", "zh-TW": "yyyy年M月d日 HH:mm" },
  yearMonth: { ja: "yyyy年M月", en: "MMMM yyyy", ko: "yyyy년 M월", "zh-CN": "yyyy年M月", "zh-TW": "yyyy年M月" },
  slashMonthDayDow: { ja: "M/d（E）", en: "M/d (EEE)", ko: "M/d (E)", "zh-CN": "M/d（E）", "zh-TW": "M/d（E）" },
};

const resolveLang = (): Lang => {
  const l = i18n.language || "ja";
  if (l in LOCALES) return l as Lang;
  const base = l.split("-")[0];
  if (base in LOCALES) return base as Lang;
  return "ja";
};

/** 現在の表示言語に合わせて日付を整形する（画面表示用）。 */
export const formatDate = (date: Date, variant: Variant): string => {
  const lang = resolveLang();
  return format(date, PATTERNS[variant][lang], { locale: LOCALES[lang] });
};
