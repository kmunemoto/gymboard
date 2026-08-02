import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";

// tenants.booking_capacity は「同時に何件受けられるか」を店ごとに設定できる機能
// （mem/features/booking-capacity.md）。仕組みとしては1人運営でも複数人運営でも
// 表現できるようになっている。
//
// **問題は仕組みではなく発見可能性だった。** 既定は1（＝従来どおりの挙動）で、
// 設定はジム設定→営業時間の奥にある。2人同時に見ている店がこれを知らないままだと、
//   - お客様の予約画面では、空いているはずの枠が「満枠」と出る
//   - トレーナーが代理予約しようとすると「すでに予約が入っています」で弾かれる
// となり、**「このアプリは同時対応に非対応」と誤解されて終わる**。
// 実際、本番の全14テナントが booking_capacity=1 のままだった（2026-08-02 に実DB照会）。
//
// そこで「設定に気づく経路」を2つ入れた。ここはその回帰テスト。
//   1. 開店時（オンボーディング step2）に必ず聞く … 新規店はこれで正しく入る
//   2. 実際に詰まった瞬間に設定の場所を案内する … 既存店はこれで気づく

const ONBOARDING = "src/pages/Onboarding.tsx";
const SCHEDULE = "src/components/trainer/TrainerSchedule.tsx";
const SETTINGS = "src/components/trainer/TrainerGymSettings.tsx";

const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
// ロケールは入れ子の深さがキーによって違う（settings.trainer.* は3階層）ので、
// 取り出し側でキャストせずに済むよう緩い型にしておく。
type LocaleTree = { [key: string]: string | LocaleTree };
const localeOf = (l: string) =>
  JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")) as LocaleTree;

/** ドット区切りのパスで文字列を取り出す。無ければ undefined。 */
const at = (tree: LocaleTree, path: string): string | undefined => {
  const found = path.split(".").reduce<string | LocaleTree | undefined>(
    (node, part) => (typeof node === "object" && node !== null ? node[part] : undefined),
    tree,
  );
  return typeof found === "string" ? found : undefined;
};

describe("1. オンボーディングで同時予約数を聞く（新規店が既定1のまま始まらないように）", () => {
  const src = readFileSync(ONBOARDING, "utf8");

  it("入力欄があり、tenants.booking_capacity として保存される", () => {
    // ここが落ちる = 聞いてはいるが保存していない（一番たちの悪い壊れ方）
    expect(src, "入力欄が無い").toMatch(/onboarding\.fieldCapacity/);
    expect(src, "booking_capacity として保存していない").toMatch(/booking_capacity:\s*bookingCapacity/);
  });

  it("選択肢が設定画面と一致している（開店時と後からで選べる数が違わない）", () => {
    const grab = (text: string, name: string) => {
      const m = text.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
      return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
    };
    const onboarding = grab(src, "CAPACITY_OPTIONS");
    const settings = grab(readFileSync(SETTINGS, "utf8"), "BUSINESS_CAPACITY_OPTIONS");
    expect(onboarding, "オンボーディング側の選択肢が読めない").toBeTruthy();
    expect(settings, "設定画面側の選択肢が読めない").toBeTruthy();
    expect(onboarding).toEqual(settings);
  });

  it("既定値は1（＝従来の挙動。勝手に複数受付にしない）", () => {
    // 既定を2以上にすると、本当に1対1の店で二重予約が通ってしまう。
    // 「分からないなら安全側」を保つ。
    expect(src).toMatch(/useState\(1\);?\s*\/\/|const \[bookingCapacity, setBookingCapacity\] = useState\(1\)/);
  });
});

describe("2. 詰まった瞬間に設定の場所を案内する（既存店が気づけるように）", () => {
  const src = readFileSync(SCHEDULE, "utf8");

  it("capacity が既定1のときだけ、設定への案内文言を出す", () => {
    // 2以上に設定済みの店は本当に埋まっているだけなので、案内を出すとかえって邪魔になる。
    expect(src).toMatch(
      /bookingCapacity <= 1\s*\?\s*t\("schedule\.errorSlotTakenCapacityHint"\)\s*:\s*t\("schedule\.errorSlotTaken"\)/,
    );
  });

  it("案内文言には設定画面までの道順が入っている（「別の時間を」で終わらせない）", () => {
    const ja = localeOf("ja");
    const hint = at(ja, "schedule.errorSlotTakenCapacityHint");
    expect(hint, "ja の文言が無い").toBeTruthy();
    // 「どこを開けばいいか」が書かれていないと、気づいても辿り着けない。
    // 設定項目名はハードコードせず、実際の設定画面の文言と一致していることを見る
    // （フォークが「ジム設定」を「院設定」等に変えても、この検査は意味を保つ）。
    const settingLabel = at(ja, "settings.trainer.businessHoursCapacity")!;
    expect(hint).toContain(settingLabel);
    expect(hint, "設定画面までの道順が無い").toMatch(/設定/);
  });
});

describe("5言語そろい（fallbackLng が ja なので欠けると日本語が出る）", () => {
  const KEYS: [string, string][] = [
    ["onboarding", "fieldCapacity"],
    ["onboarding", "fieldCapacityHint"],
    ["schedule", "errorSlotTakenCapacityHint"],
  ];

  it("全言語にキーがあり、日本語のままコピーされていない", () => {
    for (const [ns, key] of KEYS) {
      const jaVal = at(localeOf("ja"), `${ns}.${key}`);
      expect(jaVal, `ja.json に ${ns}.${key} が無い`).toBeTruthy();
      for (const l of LANGS.filter((x) => x !== "ja")) {
        const val = at(localeOf(l), `${ns}.${key}`);
        expect(val, `${l}.json に ${ns}.${key} が無い`).toBeTruthy();
        expect(val, `${l}.json の ${ns}.${key} が未翻訳`).not.toBe(jaVal);
      }
    }
  });

  it("i18n 経由で実際に引ける", async () => {
    await i18n.changeLanguage("ja");
    for (const [ns, key] of KEYS) {
      expect(i18n.t(`${ns}.${key}`), `${ns}.${key} が生キーのまま`).not.toBe(`${ns}.${key}`);
    }
  });
});
