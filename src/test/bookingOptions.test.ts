import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  OPTION_DURATION_MAX,
  OPTION_DURATION_OPTIONS,
  OPTION_NAME_MAX,
  OPTION_PRICE_MAX,
  activeOptions,
  optionMinutesFor,
  optionPriceFor,
  sessionFootprintMinutes,
  sessionMinutes,
  validateBookingOption,
  type BookingOption,
} from "@/lib/bookingOptions";

// 予約のオプション（トレーニング後の30分ストレッチなど）を見張る。
//
// ── なぜ要るか（2026-09-02）─────────────────────────────────────────
// 実店舗の要望: トレーニングのあとに 30分 3,000円 のストレッチを付けたい。
//
// 🔴 いちばん壊れやすいのは**占有時間**。宗本さんの明言:
//    「トレーニング時間とストレッチの間にもちろん15分は開けません。
//      一つのセッションの時間として扱います」。
//    間を2回取ると（60+15+30+15=120）、実際には空いている15分が予定表から消える。
//    ここを間違えても例外は出ない。夜の枠が1つ減るだけで、気づけるのは
//    「なぜか予約が取れない」と言われたとき。

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));
const readSql = (p: string) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const MIGRATION = "supabase/migrations/20260902000000_booking_options.sql";
const DELETE_GYM = "supabase/migrations/20260902000100_delete_gym_booking_options.sql";
const LIB = "src/lib/bookingOptions.ts";
const COMPONENT = "src/components/trainer/TrainerBookingOptions.tsx";
const SETTINGS = "src/components/trainer/TrainerGymSettings.tsx";
const TYPES = "src/integrations/supabase/types.ts";
const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

const opt = (o: Partial<BookingOption> & { id: string }): BookingOption => ({
  name: "追加メニューA",
  duration_minutes: 30,
  price_yen: 3000,
  ...o,
});

describe("🔴 占有時間: 間（準備時間）は1回だけ", () => {
  it("1枠60分 + オプション30分 + 間15分 = 105分（120分ではない）", () => {
    expect(sessionFootprintMinutes(60, 30, 15)).toBe(105);
  });

  it("オプション無しなら従来どおり（60 + 15 = 75分）", () => {
    expect(sessionFootprintMinutes(60, 0, 15)).toBe(75);
  });

  it("50分で回す店（50 + 30 + 25 = 105分）", () => {
    expect(sessionFootprintMinutes(50, 30, 25)).toBe(105);
  });

  it("お客様に見せる時間には間を含めない", () => {
    expect(sessionMinutes(60, 30)).toBe(90);
    expect(sessionMinutes(50, 0)).toBe(50);
  });

  it("負の値が来ても伸び縮みしない（0として扱う）", () => {
    expect(sessionFootprintMinutes(60, -30, 15)).toBe(75);
    expect(sessionFootprintMinutes(60, 30, -15)).toBe(90);
  });
});

describe("選ばれたオプションの合計", () => {
  const options = [
    opt({ id: "a", duration_minutes: 30, price_yen: 3000 }),
    opt({ id: "b", name: "プロテイン", duration_minutes: 0, price_yen: 500 }),
    opt({ id: "c", name: "整体", duration_minutes: 20, price_yen: 2000 }),
  ];

  it("時間と金額を足す", () => {
    expect(optionMinutesFor(options, ["a", "c"])).toBe(50);
    expect(optionPriceFor(options, ["a", "c"])).toBe(5000);
  });

  it("時間が増えないオプションは金額だけ足す", () => {
    expect(optionMinutesFor(options, ["b"])).toBe(0);
    expect(optionPriceFor(options, ["b"])).toBe(500);
  });

  it("同じ ID が2回来ても1回だけ数える", () => {
    expect(optionMinutesFor(options, ["a", "a"])).toBe(30);
    expect(optionPriceFor(options, ["a", "a"])).toBe(3000);
  });

  it("🔴 消されたオプションを指していても 0 として扱う（予約が読めなくならない）", () => {
    expect(optionMinutesFor(options, ["消えたID"])).toBe(0);
    expect(optionPriceFor(options, ["消えたID"])).toBe(0);
  });

  it("未選択・未読み込みは 0", () => {
    expect(optionMinutesFor(options, [])).toBe(0);
    expect(optionMinutesFor(null, ["a"])).toBe(0);
    expect(optionMinutesFor(options, null)).toBe(0);
  });
});

describe("有効なオプションの並び", () => {
  it("受け付けをやめた行は出さない。sort_order 順に並ぶ", () => {
    const list = [
      opt({ id: "c", name: "C", sort_order: 2 }),
      opt({ id: "x", name: "オフの行", sort_order: 0, enabled: false }),
      opt({ id: "a", name: "A", sort_order: 1 }),
    ];
    expect(activeOptions(list).map((o) => o.id)).toEqual(["a", "c"]);
  });

  it("enabled 未指定は有効として扱う（RPC の戻りには enabled が無い）", () => {
    expect(activeOptions([opt({ id: "a" })]).map((o) => o.id)).toEqual(["a"]);
  });

  it("未読み込みでも落ちない", () => {
    expect(activeOptions(null)).toEqual([]);
  });
});

describe("入力の検査（DB の CHECK と同じ規則）", () => {
  const base = { name: "追加メニューA", duration_minutes: 30, price_yen: 3000 };

  it("正しい入力は通る", () => {
    expect(validateBookingOption(base)).toBeNull();
    expect(validateBookingOption({ ...base, duration_minutes: 0, price_yen: 0 })).toBeNull();
  });

  it("空白だけの名前は弾く（押せるだけの空のボタンが予約画面に出るため）", () => {
    expect(validateBookingOption({ ...base, name: "   " })).toBe("name");
    expect(validateBookingOption({ ...base, name: "" })).toBe("name");
  });

  it("名前の上限は DB と同じ40文字", () => {
    expect(validateBookingOption({ ...base, name: "あ".repeat(OPTION_NAME_MAX) })).toBeNull();
    expect(validateBookingOption({ ...base, name: "あ".repeat(OPTION_NAME_MAX + 1) })).toBe("name");
  });

  it("時間・金額の範囲は DB と同じ", () => {
    expect(validateBookingOption({ ...base, duration_minutes: OPTION_DURATION_MAX })).toBeNull();
    expect(validateBookingOption({ ...base, duration_minutes: OPTION_DURATION_MAX + 1 })).toBe("duration");
    expect(validateBookingOption({ ...base, duration_minutes: -1 })).toBe("duration");
    expect(validateBookingOption({ ...base, duration_minutes: 30.5 })).toBe("duration");
    expect(validateBookingOption({ ...base, price_yen: OPTION_PRICE_MAX })).toBeNull();
    expect(validateBookingOption({ ...base, price_yen: OPTION_PRICE_MAX + 1 })).toBe("price");
    expect(validateBookingOption({ ...base, price_yen: -1 })).toBe("price");
  });

  it("🔴 lib の上限と DB の CHECK が同じ数字（片方だけ直すと画面が通して DB が拒否する）", () => {
    const sql = readSql(MIGRATION);
    expect(sql).toContain(`char_length(name) <= ${OPTION_NAME_MAX}`);
    expect(sql).toContain(`duration_minutes >= 0 AND duration_minutes <= ${OPTION_DURATION_MAX}`);
    expect(sql).toContain(`price_yen >= 0 AND price_yen <= ${OPTION_PRICE_MAX}`);
  });

  it("選べる追加時間は0分（時間が増えない）を含み、上限を超えない", () => {
    expect(OPTION_DURATION_OPTIONS[0]).toBe(0);
    expect(OPTION_DURATION_OPTIONS).toContain(30);
    expect(Math.max(...OPTION_DURATION_OPTIONS)).toBe(OPTION_DURATION_MAX);
  });
});

describe("マイグレーション", () => {
  const sql = readSql(MIGRATION);

  it("テナントに紐づき、ジムを消したら一緒に消える", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_options/);
    expect(sql).toMatch(/tenant_id\s+UUID NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE/);
  });

  it("🔴 RLS が有効で、他店の行に触れない（RESTRICTIVE の tenant_isolation）", () => {
    expect(sql).toContain("ALTER TABLE public.booking_options ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(
      /CREATE POLICY tenant_isolation ON public\.booking_options AS RESTRICTIVE/,
    );
    expect(sql).toContain("tenant_id = public.get_my_tenant_id()");
  });

  it("書き込みは owner / trainer だけ", () => {
    for (const op of ["write", "update", "delete"]) {
      const policy = sql.slice(sql.indexOf(`CREATE POLICY booking_options_${op}`));
      expect(policy.slice(0, 400)).toContain("ARRAY['owner','trainer']");
    }
  });

  it("🔴 表そのものは anon に開けない（見せるのは RPC の戻り列だけ）", () => {
    expect(sql).toContain("REVOKE ALL ON public.booking_options FROM anon");
    expect(sql).not.toMatch(/GRANT SELECT ON public\.booking_options TO anon/);
  });

  it("公開ページ用の RPC は anon から呼べて、有効な行と営業中の店だけを返す", () => {
    const rpc = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_booking_options"));
    expect(rpc).toContain("SECURITY DEFINER");
    expect(rpc).toContain("o.enabled");
    expect(rpc).toContain("t.status IN ('active', 'trial')");
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_tenant_booking_options\(UUID\) TO anon, authenticated/,
    );
  });

  it("updated_at を自動で更新する", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_touch_booking_options\s*\n\s*BEFORE UPDATE ON public\.booking_options/);
  });

  it("🔴 ジムを閉じたら booking_options も消える", () => {
    const del = readSql(DELETE_GYM);
    expect(del).toContain("DELETE FROM public.booking_options");
    // 直前の版から機械的に写しているか（取りこぼしの検出）
    expect(del).toContain("DELETE FROM public.booking_closed_days");
    expect(del).toContain("DELETE FROM public.gym_videos");
    expect(del).toContain("DELETE FROM public.email_send_log");
  });

  it("types.ts に載っている（キャストで握り潰さない）", () => {
    const types = readFileSync(TYPES, "utf8");
    expect(types).toMatch(/\n {6}booking_options: \{/);
    expect(types).toMatch(/\n {6}get_tenant_booking_options: \{/);
  });
});

describe("店側の設定画面", () => {
  const src = readCode(COMPONENT);

  it("予約のルールに出ている", () => {
    const settings = readCode(SETTINGS);
    expect(settings).toContain('import TrainerBookingOptions from "./TrainerBookingOptions"');
    expect(settings).toContain("<TrainerBookingOptions />");
  });

  it("🔴 読み込みに失敗したら保存させない（0件と取り違えて全削除しないため）", () => {
    expect(src).toContain("setLoadFailed(true)");
    expect(src).toMatch(/disabled=\{saving \|\| loading \|\| loadFailed\}/);
  });

  it("🔴 削除は最後（追加が失敗したときにオプションが静かに消えないため）", () => {
    const update = src.indexOf('.update(values as never)');
    const insert = src.indexOf('.insert(added as never)');
    const remove = src.indexOf('.delete().eq("tenant_id"');
    expect(update).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(update);
    expect(remove).toBeGreaterThan(insert);
  });

  it("🔴 保存しても id が変わらない（過去の予約から何を付けたか辿れなくなるため）", () => {
    // 差し替え（全削除→全挿入）ではなく、既存行は update している
    expect(src).toContain('.eq("id", id as string)');
  });

  it("入力は保存前に検査する（DB の CHECK で弾かれる前に理由を出す）", () => {
    expect(src).toContain("validateBookingOption");
    expect(src).toContain("bookingOptions.invalid.");
  });

  it("🔴 お客様の画面にはまだ出ないことを画面に明記している", () => {
    expect(src).toContain("bookingOptions.notYetCustomerNote");
  });
});

describe("文言（5言語）", () => {
  const KEYS = [
    "section", "desc", "empty", "loadFailed", "reload", "addOption",
    "nameLabel", "namePlaceholder", "durationLabel", "durationNone", "durationUnit",
    "priceLabel", "pricePlaceholder", "priceHint",
    "enabledLabel", "disabledLabel", "saved", "cleared", "saveFailed",
    "footprintNote", "notYetCustomerNote",
  ];

  for (const lang of LOCALES) {
    it(`${lang} に bookingOptions の文言がそろっている`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      const block = json.bookingOptions;
      expect(block, `${lang}.json に bookingOptions が無い`).toBeTruthy();
      for (const k of KEYS) {
        expect(block[k], `${lang}.json bookingOptions.${k}`).toBeTruthy();
      }
      for (const k of ["name", "duration", "price"]) {
        expect(block.invalid?.[k], `${lang}.json bookingOptions.invalid.${k}`).toBeTruthy();
      }
    });
  }

  it("分の表示は複数形に耐える形（{{count}}）", () => {
    const ja = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));
    const en = JSON.parse(readFileSync("src/locales/en.json", "utf8"));
    expect(ja.bookingOptions.durationUnit).toContain("{{count}}");
    expect(en.bookingOptions.durationUnit).toContain("{{count}}");
  });
});

describe("🔴 まだ変えていないもの（次の版で触るところの目印）", () => {
  it("check_booking_overlap はオプションの分を足していない（足すときは2箇所を同時に）", () => {
    const trigger = readSql("supabase/migrations/20260821030000_booking_capacity_windows.sql");
    expect(trigger).not.toContain("option_minutes");
    // footprint を計算している箇所は**3つ**ある:
    //   1. これから入れる予約   2. 既存の bookings   3. 既存の trial_bookings
    // 片方だけ直すと「Aの後にBは取れるのにBの後にAは取れない」非対称になる。
    const sites = [...trigger.matchAll(/COALESCE\(buffer_min, 15\)/g)];
    expect(sites.length).toBe(3);
  });
});
