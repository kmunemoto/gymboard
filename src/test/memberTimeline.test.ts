import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  dateOnlyToIso, sortTimeline, dayKeyOf, groupByDay, buildTimeline,
  bookingEvents, workoutEvents, measurementEvents, paymentEvents,
  agreementEvents, photoEvents, type TimelineEvent,
} from "@/lib/memberTimeline";

// カルテの活動タイムライン（2026-08-26）の見張り。
//
// カルテはタブが7本あり、来店・記録・測定・入金・同意が別々の場所にある。
// セッション前に「前回どうだったか」を見るのに4回タブを行き来していた。
//
// 🔴 守っている不変条件:
//   1. 日付だけの列を JST として扱う（UTC 解釈だと9時間ずれて前日になる）
//   2. トレーニング記録が日ごとに畳まれる（畳まないと記録で埋まる）
//   3. 取得が tenant_id ＋ user_id で絞られている（他人の記録が混ざらない）
//   4. 1種類の取得が失敗しても、他は出る

const CANCELLED = "キャンセル済み";

describe("🔴 日付だけの列を JST として扱う", () => {
  it("date 型を JST の 0 時にそろえる", () => {
    // new Date("2026-08-26") は UTC の 0 時。そのまま JST 表示すると前日になる
    expect(dateOnlyToIso("2026-08-26")).toBe("2026-08-26T00:00:00+09:00");
  });

  it("JST の日付として同じ日に入る（前日にずれない）", () => {
    expect(dayKeyOf(dateOnlyToIso("2026-08-26"))).toBe("2026-08-26");
  });

  it("JST 深夜の予約が翌日に回らない", () => {
    // 2026-08-26 23:30 JST = 14:30 UTC。UTC で日付を取ると 08-26 のままだが、
    // 逆（JST 0:30 = 前日 15:30 UTC）で崩れやすいので両方見る
    expect(dayKeyOf("2026-08-26T23:30:00+09:00")).toBe("2026-08-26");
    expect(dayKeyOf("2026-08-26T00:30:00+09:00")).toBe("2026-08-26");
  });
});

describe("並べ替えと日ごとのまとめ", () => {
  const ev = (id: string, at: string, kind: TimelineEvent["kind"] = "booking"): TimelineEvent =>
    ({ id, at, kind, labelKey: "x" });

  it("新しい順に並ぶ", () => {
    const out = sortTimeline([
      ev("a", "2026-08-20T10:00:00+09:00"),
      ev("c", "2026-08-26T10:00:00+09:00"),
      ev("b", "2026-08-24T10:00:00+09:00"),
    ]);
    expect(out.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("同時刻でも並びが安定する（描画がちらつかない）", () => {
    const same = "2026-08-26T10:00:00+09:00";
    const a = sortTimeline([ev("x", same, "workout"), ev("y", same, "booking")]);
    const b = sortTimeline([ev("y", same, "booking"), ev("x", same, "workout")]);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });

  it("日ごとにまとまる", () => {
    const days = groupByDay(sortTimeline([
      ev("a", "2026-08-26T10:00:00+09:00"),
      ev("b", "2026-08-26T18:00:00+09:00"),
      ev("c", "2026-08-24T10:00:00+09:00"),
    ]));
    expect(days.map((d) => d.day)).toEqual(["2026-08-26", "2026-08-24"]);
    expect(days[0].events).toHaveLength(2);
  });

  it("空でも落ちない", () => {
    expect(groupByDay([])).toEqual([]);
    expect(sortTimeline([])).toEqual([]);
  });
});

describe("予約", () => {
  it("来店とキャンセルを別の種類にする", () => {
    const out = bookingEvents([
      { id: "1", booking_date: "2026-08-26T10:00:00+09:00", booking_type: "通常", status: "予約済み" },
      { id: "2", booking_date: "2026-08-25T10:00:00+09:00", booking_type: "通常", status: CANCELLED },
    ], CANCELLED);
    expect(out[0].kind).toBe("booking");
    expect(out[1].kind).toBe("cancelled");
  });

  it("🔴 キャンセルも残す（来なかったことも事実）", () => {
    const out = bookingEvents(
      [{ id: "1", booking_date: "2026-08-25T10:00:00+09:00", booking_type: "通常", status: CANCELLED }],
      CANCELLED,
    );
    expect(out).toHaveLength(1);
  });
});

describe("🔴 トレーニング記録は日ごとに畳む", () => {
  it("1回のセッションの種目行が1件になる", () => {
    // 畳まないと、10種目やった日はタイムラインが10行になって他が埋もれる
    const out = workoutEvents([
      { id: "a", workout_date: "2026-08-26", exercise_name: "ベンチプレス" },
      { id: "b", workout_date: "2026-08-26", exercise_name: "スクワット" },
      { id: "c", workout_date: "2026-08-26", exercise_name: "デッドリフト" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].labelValues?.count).toBe(3);
  });

  it("日が違えば別の件", () => {
    const out = workoutEvents([
      { id: "a", workout_date: "2026-08-26", exercise_name: "A" },
      { id: "b", workout_date: "2026-08-25", exercise_name: "B" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("種目名は多すぎないように切る", () => {
    const out = workoutEvents(
      ["A", "B", "C", "D", "E"].map((n, i) => ({ id: String(i), workout_date: "2026-08-26", exercise_name: n })),
    );
    expect(out[0].detail).toBe("A・B・C");
    expect(out[0].labelValues?.count).toBe(5);
  });

  it("同じ種目を繰り返しても名前は1回だけ", () => {
    const out = workoutEvents([
      { id: "a", workout_date: "2026-08-26", exercise_name: "ベンチプレス" },
      { id: "b", workout_date: "2026-08-26", exercise_name: "ベンチプレス" },
    ]);
    expect(out[0].detail).toBe("ベンチプレス");
    expect(out[0].labelValues?.count).toBe(2);
  });

  it("種目名が無くても落ちない", () => {
    const out = workoutEvents([{ id: "a", workout_date: "2026-08-26", exercise_name: null }]);
    expect(out[0].detail).toBeUndefined();
  });
});

describe("測定・入金・同意・写真", () => {
  it("測定は値が無くても出す（測ったこと自体が記録）", () => {
    const out = measurementEvents([{ id: "1", measured_date: "2026-08-26", weight: null, body_fat: null }]);
    expect(out).toHaveLength(1);
    expect(out[0].labelValues).toEqual({ weight: "-", fat: "-" });
  });

  it("入金は金額を3桁区切りにする", () => {
    const out = paymentEvents([{ id: "1", paid_on: "2026-08-26", amount_yen: 22000, method: "現金" }]);
    expect(out[0].labelValues?.amount).toBe("22,000");
    expect(out[0].detail).toBe("現金");
  });

  it("同意は題名を補足に出す", () => {
    const out = agreementEvents([{ id: "1", agreed_on: "2026-08-26", title: "ABC規程" }]);
    expect(out[0].detail).toBe("ABC規程");
  });

  it("写真も時系列に乗る", () => {
    expect(photoEvents([{ id: "1", taken_date: "2026-08-26" }])[0].kind).toBe("photo");
  });
});

describe("混ぜて切る", () => {
  it("全部混ぜて新しい順・上限まで", () => {
    const out = buildTimeline([
      bookingEvents([{ id: "1", booking_date: "2026-08-20T10:00:00+09:00", booking_type: "通常", status: "予約済み" }], CANCELLED),
      workoutEvents([{ id: "2", workout_date: "2026-08-26" }]),
      paymentEvents([{ id: "3", paid_on: "2026-08-24", amount_yen: 100 }]),
    ], 2);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("workout");   // 8/26
    expect(out[1].kind).toBe("payment");   // 8/24
  });

  it("種類が1つも無くても落ちない", () => {
    expect(buildTimeline([[], [], []], 10)).toEqual([]);
  });

  it("一意キーが種類をまたいで衝突しない", () => {
    // どの種類も同じ id="1" を持ちうる（別テーブルなので）
    const out = buildTimeline([
      measurementEvents([{ id: "1", measured_date: "2026-08-26", weight: 70, body_fat: 20 }]),
      paymentEvents([{ id: "1", paid_on: "2026-08-26", amount_yen: 100 }]),
      photoEvents([{ id: "1", taken_date: "2026-08-26" }]),
    ], 10);
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length);
  });
});

describe("🔴 取得の絞り", () => {
  const src = readFileSync("src/lib/memberTimelineData.ts", "utf8");

  it("テナントと本人の両方で絞る", () => {
    // 片方だけだと他のお客様の記録がカルテに混ざる
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain('.eq("user_id", userId)');
  });

  it("読み取りだけ（画面から書き換えない）", () => {
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it("種類ごとに件数の上限がある", () => {
    expect(src).toMatch(/const PER_KIND = \d+/);
    expect(src).toMatch(/\.limit\(PER_KIND\)/);
  });

  it("並行に取る（直列だと6往復待たされる）", () => {
    expect(src).toContain("await Promise.all([");
  });

  it("🔴 1種類が失敗しても他は出す", () => {
    // カルテが真っ白になるより「入金だけ出ていない」ほうが害が小さい
    expect(src).toMatch(/const safe = async/);
    expect(src).toMatch(/return \[\];/);
  });
});

describe("画面への配線", () => {
  const detail = readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8");
  const screen = readFileSync("src/components/trainer/clientDetail/MemberTimeline.tsx", "utf8");

  it("カルテの概要タブに載っている", () => {
    expect(detail).toContain("MemberTimeline");
    expect(detail).toMatch(/<MemberTimeline[\s\S]{0,200}clientId=\{clientId\}/);
  });

  it("記録を保存したら作り直す", () => {
    expect(detail).toMatch(/refreshKey=\{memberRefreshKey\}/);
  });

  it("全部の種類にアイコンがある（未定義で落ちない）", () => {
    for (const k of ["booking", "cancelled", "workout", "measurement", "payment", "agreement", "photo"]) {
      expect(screen, `${k} のアイコンが無い`).toMatch(new RegExp(`${k}:`));
    }
  });

  it("最初は畳んでおく（概要タブが長くなりすぎない）", () => {
    expect(screen).toMatch(/const INITIAL_DAYS = \d+/);
    expect(screen).toContain("timeline.expand");
  });
});
