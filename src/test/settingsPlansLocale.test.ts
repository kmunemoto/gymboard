import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// プランごとの予約枠の間隔（tenant_plans.slot_duration_minutes、
// mem/features/plan-slot-duration.md）で追加した settings.plans.* キーの回帰テスト。
// authSignupSent.test.tsx の「翻訳キーの5言語そろい」と同じ狙い:
// fallbackLng が ja のため、キーが1言語でも欠けると気づかないまま日本語が出てしまう。

const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const plansOf = (l: string) =>
  JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).settings.plans as Record<string, string>;

const NEW_KEYS = ["slotDuration", "slotDurationInherit", "slotDurationHint", "slotDurationSuffix"];

describe("プラン管理の予約枠の間隔キー（settings.plans.slotDuration*）", () => {
  it("全言語にキーがある", () => {
    for (const key of NEW_KEYS) {
      for (const l of LANGS) {
        expect(plansOf(l)[key], `${l}.json に settings.plans.${key} が無い`).toBeTruthy();
      }
    }
  });

  it("settings.plans 配下のキー集合が5言語で一致する", () => {
    const base = Object.keys(plansOf("ja")).sort();
    for (const l of LANGS.filter((x) => x !== "ja")) {
      const keys = Object.keys(plansOf(l)).sort();
      const missing = base.filter((k) => !keys.includes(k));
      expect(missing, `${l}.json に足りない settings.plans キー: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("日本語のまま他言語へコピーされていない", () => {
    for (const key of NEW_KEYS) {
      const ja = plansOf("ja")[key];
      for (const l of LANGS.filter((x) => x !== "ja")) {
        expect(plansOf(l)[key], `${l}.json の settings.plans.${key} が未翻訳`).not.toBe(ja);
      }
    }
  });
});
