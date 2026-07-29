import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  resolveBusinessProfile,
  isClinicBusiness,
  CLINIC_BODY_PARTS,
  type BusinessType,
} from "@/lib/businessProfile";
import { DEFAULT_TENANT_MUSCLE_GROUPS } from "@/lib/tenantMuscleGroups";
import { DEFAULT_DORMANT_DAYS } from "@/lib/dormancy";

// business_type を「保存されているだけの死に列」から表示プロファイルの解決キーに
// 格上げしたことで、本番（Salute御所南ほか、全て personal_gym）の挙動が
// 静かに変わる余地ができた。ここはその余地を機械的に塞ぐための網。

describe("personal_gym の解決結果は現行の既定値と完全に一致する", () => {
  // このテストが落ちたら、それは「接骨院向けの調整が本番のジムに漏れた」という意味。
  // 期待値を書き換えて通すのではなく、businessProfile.ts 側を直すこと。
  const p = resolveBusinessProfile("personal_gym");

  it("部位マスタのシードは DEFAULT_TENANT_MUSCLE_GROUPS のまま", () => {
    expect(p.defaultBodyParts).toEqual(DEFAULT_TENANT_MUSCLE_GROUPS);
    expect(p.defaultBodyParts).toEqual(["胸", "背中", "肩", "脚", "お尻", "二頭筋", "三頭筋", "腹筋"]);
  });

  it("休眠判定は DEFAULT_DORMANT_DAYS（30日）のまま", () => {
    expect(p.defaultDormantDays).toBe(DEFAULT_DORMANT_DAYS);
    expect(p.defaultDormantDays).toBe(30);
  });

  it("予約枠の選択肢は Onboarding / TrainerGymSettings の定数と一致", () => {
    // 現行: src/pages/Onboarding.tsx の SLOT_OPTIONS
    //       src/components/trainer/TrainerGymSettings.tsx の BUSINESS_SLOT_OPTIONS
    expect(p.slotDurationOptions).toEqual([30, 45, 60, 90, 120]);
    for (const file of [
      "src/pages/Onboarding.tsx",
      "src/components/trainer/TrainerGymSettings.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} の枠の選択肢が変わっている`).toMatch(/\[30, 45, 60, 90, 120\]/);
    }
  });

  it("用語オーバーレイを持たない（ja.json のまま）", () => {
    expect(p.terminologyOverlay).toBeNull();
  });

  it("規制業種ではなく、口コミ依頼を出せる", () => {
    expect(p.regulated).toBe(false);
    expect(p.allowReviewPrompt).toBe(true);
  });

  it("未設定・未知の business_type も personal_gym と同じ結果になる", () => {
    // DB の CHECK 制約に値を足しただけでコードが落ちる、という壊れ方をさせない。
    for (const v of [null, undefined, "", "pilates", "yoga", "other", "未知の値"]) {
      expect(resolveBusinessProfile(v as string | null), `${v} で挙動が変わっている`).toEqual(p);
      expect(isClinicBusiness(v as string | null)).toBe(false);
    }
  });
});

describe("施術所（clinic）プロファイル", () => {
  // 整体（seitai）と接骨院（judo_therapy）は法的には別カテゴリだが、
  // 画面の用語という観点では同じ（患者・院・施術）なので同じプロファイルに寄せている。
  it("seitai と judo_therapy は同じプロファイルに解決される", () => {
    const a = resolveBusinessProfile("seitai");
    const b = resolveBusinessProfile("judo_therapy");
    expect(a).toBe(b);
    expect(a.key).toBe("clinic");
    expect(isClinicBusiness("seitai")).toBe(true);
    expect(isClinicBusiness("judo_therapy")).toBe(true);
  });

  it("部位マスタは施術部位になる", () => {
    expect(resolveBusinessProfile("seitai").defaultBodyParts).toEqual(CLINIC_BODY_PARTS);
    expect(CLINIC_BODY_PARTS).toContain("腰部");
    expect(CLINIC_BODY_PARTS).not.toContain("二頭筋");
  });

  it("口コミ依頼は既定で出さない（柔道整復師法24条の広告規制）", () => {
    // 依頼・誘導した患者の体験談は広告規制の対象になりうる。
    // 現場の判断に委ねず、コード側で既定OFFにしておく。
    expect(resolveBusinessProfile("judo_therapy").allowReviewPrompt).toBe(false);
    expect(resolveBusinessProfile("judo_therapy").regulated).toBe(true);
  });

  it("短い施術に合わせて15分・20分の予約枠を持つ", () => {
    // 1日30〜40人が15分前後で回る現場なので、ジム向けの最短30分では足りない。
    const opts = resolveBusinessProfile("seitai").slotDurationOptions;
    expect(opts).toContain(15);
    expect(opts).toContain(20);
  });
});

describe("用語オーバーレイ（ja.clinic.json）", () => {
  const overlay = JSON.parse(readFileSync("src/locales/ja.clinic.json", "utf8"));
  const base = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));

  const leaves = (o: Record<string, unknown>, p = ""): [string, unknown][] =>
    Object.entries(o).flatMap(([k, v]) => {
      const path = p ? `${p}.${k}` : k;
      return v && typeof v === "object" && !Array.isArray(v)
        ? leaves(v as Record<string, unknown>, path)
        : [[path, v] as [string, unknown]];
    });

  const at = (obj: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

  it("オーバーレイのキーは全て ja.json に実在する", () => {
    // ja.json 側でキーを改名すると、オーバーレイが静かに効かなくなる
    // （i18next は存在しないキーを足すだけで何も言わない）。ここで気づけるようにする。
    const missing = leaves(overlay)
      .map(([k]) => k)
      .filter((k) => k !== "_comment" && at(base, k) === undefined);
    expect(missing, `ja.json に無いキー: ${missing.join(", ")}`).toEqual([]);
  });

  it("差し替え後も文言が変わっている（無意味なキーを残さない）", () => {
    const same = leaves(overlay)
      .filter(([k]) => k !== "_comment")
      .filter(([k, v]) => at(base, k) === v)
      .map(([k]) => k);
    expect(same, `ja.json と同じ文言のキー: ${same.join(", ")}`).toEqual([]);
  });

  it("補間変数（{{...}}）を落としていない", () => {
    // {{count}} や {{limit}} を書き忘れると、数字が消えた文言が出る。
    const vars = (s: string) => (s.match(/\{\{[^}]+\}\}/g) || []).sort();
    for (const [k, v] of leaves(overlay)) {
      if (k === "_comment" || typeof v !== "string") continue;
      const orig = at(base, k);
      if (typeof orig !== "string") continue;
      expect(vars(v), `${k} の補間変数が元と違う`).toEqual(vars(orig));
    }
  });

  it("ジム向けの語彙が残っていない", () => {
    const offenders = leaves(overlay)
      .filter(([k]) => k !== "_comment")
      .filter(([, v]) => typeof v === "string" && /お客様|トレーナー|ジム(?!ボード)/.test(v as string))
      .map(([k]) => k);
    expect(offenders, `置き換え漏れ: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("business_type の直接比較を禁止する", () => {
  // 分岐の条件は businessProfile.ts だけが持つ。画面側に `business_type === "seitai"` が
  // 散ると、業種が増えるたびに全画面を grep する羽目になり、必ず抜ける。
  // 規約で守らせるのではなく、ここで機械的に止める。
  it("businessProfile.ts 以外に business_type との直接比較が無い", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file)) continue;
      if (file === "src/lib/businessProfile.ts" || file.startsWith("src/test/")) continue;
      const src = readFileSync(file, "utf8");
      // business_type / businessType の直後に比較演算子が来るもの
      if (/business_?[Tt]ype\s*[!=]==?\s*["'`]/.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `resolveBusinessProfile() / isClinicBusiness() を使うこと: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
