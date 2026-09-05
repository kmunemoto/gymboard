import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAY_CLOSED_SQLSTATE,
  closedDayReason,
  countsTowardDailyLimit,
  isDayAtLimit,
  isDayClosed,
  isDayClosedForBooking,
  isDayClosedError,
  remainingForDay,
  type ClosedDay,
} from "@/lib/bookingClosedDays";

// 「その日はもう受け付けない」を見張る。
//
// ── なぜ要るか（2026-09-01）─────────────────────────────────────────
// 実店舗の要望: 1日に見られる人数には限りがある。上限に達したら、枠が空いていても
// その日の受付を止めたい。枠を1つずつブロックするのは操作が多すぎる。
//
// 止める規則は **DB（tenant_day_closed → GB007）が正**で、画面はそれを先に見せる
// だけ。両者がずれると「空きに見えるのに予約できない」「止めたのに入ってくる」の
// どちらかが起きる。しかもどちらもエラーにはならず、気づけるのは事故のあと。

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

const MIGRATION = "supabase/migrations/20260901000000_booking_daily_cap.sql";
const TRIAL_EXEMPT = "supabase/migrations/20260901010000_trial_exempt_from_daily_cap.sql";
const LIB = "src/lib/bookingClosedDays.ts";
const CUSTOMER = "src/components/customer/CustomerBooking.tsx";
const TRIAL = "src/pages/TrialBooking.tsx";
const DROPIN = "src/pages/DropInBooking.tsx";
const SCHEDULE = "src/components/trainer/TrainerSchedule.tsx";

const days: ClosedDay[] = [
  { closed_date: "2026-09-10", manual: true, reason: "満員のため" },
  { closed_date: "2026-09-12", manual: false, reason: null },
];

describe("受付を終了した日の判定", () => {
  it("手で閉めた日も、上限で閉まった日も、同じく「閉まっている」", () => {
    expect(isDayClosed(days, "2026-09-10")).toBe(true);
    expect(isDayClosed(days, "2026-09-12")).toBe(true);
  });

  it("閉まっていない日は false", () => {
    expect(isDayClosed(days, "2026-09-11")).toBe(false);
  });

  it("読めなかったとき（null/空）は「閉まっている日は無い」に倒す", () => {
    // 🔴 逆に倒すと、マイグレーション未適用の環境で**全日が予約不可**になる。
    expect(isDayClosed(null, "2026-09-10")).toBe(false);
    expect(isDayClosed(undefined, "2026-09-10")).toBe(false);
    expect(isDayClosed([], "2026-09-10")).toBe(false);
    expect(isDayClosed(days, "")).toBe(false);
  });

  it("理由と、手動か自動かを取り出せる", () => {
    expect(closedDayReason(days, "2026-09-10")).toEqual(days[0]);
    expect(closedDayReason(days, "2026-09-12")?.manual).toBe(false);
    expect(closedDayReason(days, "2026-09-11")).toBeNull();
  });
});

describe("1日の人数の数え方", () => {
  it("🔴 「同日キャンセル済み」は数える（DB と同じ）", () => {
    // 予定表には枠として残り続けるもの。空きとして数えると、
    // 受付終了にしたはずの日がひとりでに開く。
    expect(countsTowardDailyLimit("同日キャンセル済み")).toBe(true);
    expect(countsTowardDailyLimit("予約済み")).toBe(true);
    expect(countsTowardDailyLimit("完了")).toBe(true);
  });

  it("キャンセル済みだけ数えない", () => {
    expect(countsTowardDailyLimit("キャンセル済み")).toBe(false);
  });

  it("残り件数と上限到達", () => {
    expect(remainingForDay(5, 3)).toBe(2);
    expect(remainingForDay(5, 5)).toBe(0);
    expect(remainingForDay(5, 9)).toBe(0);
    expect(isDayAtLimit(5, 4)).toBe(false);
    expect(isDayAtLimit(5, 5)).toBe(true);
    expect(isDayAtLimit(5, 6)).toBe(true);
  });

  it("上限が未設定なら「制限なし」", () => {
    expect(remainingForDay(null, 100)).toBeNull();
    expect(remainingForDay(undefined, 100)).toBeNull();
    expect(isDayAtLimit(null, 100)).toBe(false);
    expect(isDayAtLimit(0, 100)).toBe(false);
  });
});

describe("エラーの見分け", () => {
  it("GB007 を受付終了として拾う", () => {
    expect(isDayClosedError({ code: DAY_CLOSED_SQLSTATE })).toBe(true);
    expect(isDayClosedError({ message: "この日はご予約の受付を終了しました" })).toBe(true);
  });
  it("別のエラーは拾わない", () => {
    expect(isDayClosedError({ code: "GB006" })).toBe(false);
    expect(isDayClosedError({ message: "この時間帯はすでに予約が入っています" })).toBe(false);
    expect(isDayClosedError(null)).toBe(false);
    expect(isDayClosedError("GB007")).toBe(false);
  });
});

describe("DB の規則と画面の規則が一致している", () => {
  const sql = readSql(MIGRATION);
  const exempt = readSql(TRIAL_EXEMPT);
  const lib = readCode(LIB);

  it("🔴 SQLSTATE が一致している", () => {
    expect(sql).toContain(`ERRCODE = '${DAY_CLOSED_SQLSTATE}'`);
    expect(lib).toContain(`"${DAY_CLOSED_SQLSTATE}"`);
  });

  it("🔴 数える条件が一致している（キャンセル済みだけ除く）", () => {
    const occurrences = exempt.match(/status <> 'キャンセル済み'/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    // 「同日キャンセル済み」を名指しで外していないこと（外すと画面とずれる）
    expect(exempt).not.toContain("同日キャンセル済み");
  });

  it("🔴 ブロック枠は数えない（予約ではないため）", () => {
    // blocked_slots を数え始めると、休憩を入れただけで受付が止まる。
    expect(sql).not.toContain("blocked_slots");
    expect(exempt).not.toContain("blocked_slots");
  });
});

describe("🔴 体験・ドロップインは仕組みから完全に外れている（2026-09-01）", () => {
  // 宗本さんの指示:「体験予約はこのシステムの例外にします。体験予約は上限なく
  // 受け付けます」。止めないだけでなく、1日の人数にも数えない。
  const exempt = readSql(TRIAL_EXEMPT);

  it("体験のトリガーを落としている（受付を止めた日でも入る）", () => {
    expect(exempt).toContain("DROP TRIGGER IF EXISTS trg_guard_trial_booking_day_closed");
    expect(exempt).toContain("DROP FUNCTION IF EXISTS public.guard_trial_booking_day_closed");
  });

  it("🔴 人数の数え方から trial_bookings を外している", () => {
    // 作り直した2つの関数のどちらにも trial_bookings が残っていないこと。
    const rebuilt = exempt.slice(exempt.indexOf("CREATE OR REPLACE FUNCTION public.tenant_day_booking_count"));
    expect(rebuilt).not.toContain("trial_bookings");
  });

  it("🔴 公開RPC も会員予約しか数えていない", () => {
    const rpc = exempt.slice(exempt.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_closed_days"));
    expect(rpc).not.toContain("trial_bookings");
    expect(rpc).toContain("public.bookings");
  });

  it("🔴 予定表の人数も体験行を落としている（DB と同じ答えにする）", () => {
    // ここを落とし忘れると、予定表だけ人数が多く見えて
    // 「あと0人と出ているのにまだ取れる」になる。
    const hook = readCode("src/hooks/useDayReception.ts");
    expect(hook).toContain("trial-guest");
    expect(hook).toMatch(/b\.user_id !== TRIAL_GUEST/);
  });

  it("🔴 公開の体験ページ・ドロップインページは受付終了を見ていない", () => {
    // DB が止めないのに画面だけ止めると、予約できるはずの枠が消える。
    for (const f of [TRIAL, DROPIN]) {
      expect(readCode(f), f).not.toContain("isDayClosed");
      expect(readCode(f), f).not.toContain("useBookingClosedDays");
    }
  });

  it("会員アプリ側は今までどおり止まる", () => {
    expect(readCode(CUSTOMER)).toContain("isDayClosed");
    expect(readCode(CUSTOMER)).toContain("useBookingClosedDays");
  });
});

describe("店側の代理予約には効かない（GB003/GB004/GB006 と同じ非対称）", () => {
  const sql = readSql(MIGRATION);

  it("🔴 会員予約のガードは「自分で取る予約」だけを見る", () => {
    // これが無いと、店が自分の予定表から1人足すこともできなくなる。
    expect(sql).toMatch(/v_actor IS NULL OR v_actor IS DISTINCT FROM NEW\.user_id/);
  });

  it("外部同期の行は素通しする", () => {
    expect(sql).toContain("salute_sync");
  });

  it("キャンセル済みからの復活を抜け道にしていない", () => {
    // キャンセル行を先に置いて後から復活させると、閉めた日に入れてしまう。
    expect(sql).toMatch(/OLD\.status = 'キャンセル済み'/);
  });
});

describe("会員の予約画面が受付終了を反映している", () => {
  it("規則は RPC 1本に集約されている（画面ごとに組み立てない）", () => {
    expect(readCode(CUSTOMER)).toContain("useBookingClosedDays");
    expect(readCode("src/hooks/useBookingClosedDays.ts")).toContain("get_tenant_closed_days");
  });

  it("🔴 閉まっている日はカレンダーで選べない（会員アプリ）", () => {
    // 2026-09-05 に isDayClosed → isDayClosedForBooking へ差し替えた
    // （上限で閉まった日は、その日の自分の予約を動かすときだけ開ける）。
    // 塞ぐこと自体は変わっていない。
    expect(readCode(CUSTOMER)).toMatch(
      /if \(isDayClosedForBooking\(closedDays, yyyyMMdd, rescheduleFromDate\)\) return true;/,
    );
  });

  it("🔴 閉まっている日は1枠も出さない（キャンセル待ちにも出せない）", () => {
    expect(readCode(CUSTOMER)).toMatch(/if \(selectedDayClosed\) return slots;/);
  });

  it("公開ページは匿名でも読めるように RPC へ GRANT している", () => {
    expect(readSql(MIGRATION)).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_tenant_closed_days\(uuid, date, date\) TO anon, authenticated;/,
    );
  });

  it("🔴 内部関数は匿名に開けていない（件数や上限を外から引けない）", () => {
    const sql = readSql(MIGRATION);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_day_booking_count[^;]*FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_day_closed[^;]*FROM PUBLIC, anon, authenticated;/);
  });
});

describe("予定表からワンタップで止められる", () => {
  const schedule = readCode(SCHEDULE);

  it("🔴 止める・戻すの両方が予定表にある（戻せないと運用にならない）", () => {
    expect(schedule).toContain("DayReceptionToggle");
    const toggle = readCode("src/components/trainer/DayReceptionToggle.tsx");
    expect(toggle).toContain("onClose");
    expect(toggle).toContain("onReopen");
  });

  it("🔴 上限で自動的に閉まった日は、その場では戻せない", () => {
    // 戻せてしまうと「解除したのにまた閉まる」になる。上限を上げるのが筋。
    const toggle = readCode("src/components/trainer/DayReceptionToggle.tsx");
    expect(toggle).toMatch(/if \(closed && !closed\.manual\)/);
  });

  it("🔴 **既定の表示**（週間ビュー）にスイッチがある", () => {
    // 2026-09-01 に実際に踏んだ: 日別ビューにだけ入れて満足していたが、予定表の
    // 既定は週間ビュー。「日別へ切り替えてから押す」では**ワンタップにならない**。
    // 画面を出して数えるまで気づけなかった。
    expect(readCode("src/components/trainer/WeekTimelineView.tsx")).toContain("renderDayReception");
    expect(schedule).toContain("renderDayReception=");
  });

  it("人数の数え方は DB と同じ関数を通している", () => {
    expect(readCode("src/hooks/useDayReception.ts")).toContain("countsTowardDailyLimit");
    // ブロック枠を数えていないこと
    expect(readCode("src/hooks/useDayReception.ts")).toContain("!b.isBlocked");
  });
});

describe("列が読めない環境でも予約が止まらない", () => {
  it("🔴 daily_booking_limit の既定は「上限なし」", () => {
    // ここに数字を置くと、マイグレーション未適用の環境で全店の受付が勝手に止まる。
    const cols = readCode("src/lib/tenantColumns.ts");
    expect(cols).toMatch(/daily_booking_limit: null/);
    expect(cols).toContain('"daily_booking_limit"');
  });

  it("読み込みに失敗したら空配列（＝閉まっている日は無い）", () => {
    const hook = readCode("src/hooks/useBookingClosedDays.ts");
    expect(hook).toMatch(/if \(error \|\| !data\) \{\s*setClosedDays\(\[\]\);/);
  });
});

describe("🔴 設定画面の説明文が実装とずれていない", () => {
  // 2026-09-02 に実際にずれていた。体験・ドロップインを仕組みから外した
  // （20260901010000）のに、5言語すべての説明文が「体験・ドロップインの予約も
  // 1件として数えます」のままだった。読んだ店主は上限を実態より小さく設定する。
  //
  // ⚠️ 文言そのものは断言しない（フォークがオーバーレイできなくなる）。
  //    「数える」と書いていないことだけを見る。
  const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const COUNTS_TRIAL = [
    /体験・ドロップインの予約も1件として数えます/,
    /Trial and drop-in bookings count/i,
    /체험·드롭인 예약도 1건으로 계산합니다/,
    /体验和临时预约同样计入/,
    /體驗與臨時預約同樣計入/,
  ];

  for (const lang of LOCALES) {
    it(`${lang}: 1日の上限の説明が「体験も数える」と言っていない`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      const desc: string = json.closedDays.limitDesc;
      expect(desc).toBeTruthy();
      for (const re of COUNTS_TRIAL) {
        expect(desc, `${lang}.json closedDays.limitDesc が古い（体験は数えない）`).not.toMatch(re);
      }
    });
  }

  it("数え方の実装は体験を含まない（説明文の根拠）", () => {
    // useDayReception は trial-guest を除いて数えている
    expect(readCode("src/hooks/useDayReception.ts")).toContain("TRIAL_GUEST");
    // DB 側にも体験用のトリガーは残っていない
    const exempt = readSql(TRIAL_EXEMPT);
    expect(exempt).toContain("DROP TRIGGER IF EXISTS trg_guard_trial_booking_day_closed");
  });
});

// ────────────────────────────────────────────────────────────────
// 予約変更のときだけ、上限で閉まった日を開ける（2026-09-05 宗本さんの要望）
//
// > 一日四枠までに設定したら、四枠入っている日はグレーになって押せなくなる。
// > 当日でもグレーで、何時が空いているか分からない。
// > その日に予約している人が、時間を後ろにずらせるか確認したいらしい。
//
// 🔴 **DB がすでにそれを許している。** tenant_day_closed の第3引数
//    p_exclude_booking_id で、動かす予約自身を数えずに上限と比べるため
//    （4枠のうち1枠は自分なので実質 3/4）。塞いでいたのは画面だけだった。
//
// 🔴 ただし「手で止めた日」は DB が断る（booking_closed_days に行があり、
//    除外とは無関係）。一律に開けると「押せたのにサーバーに断られる」が起きる。
// ────────────────────────────────────────────────────────────────

describe("予約変更のときの受付終了の判定", () => {
  it("ふつうの予約（変更中でない）では、今までどおり両方とも閉まっている", () => {
    expect(isDayClosedForBooking(days, "2026-09-10", null)).toBe(true); // 手で止めた
    expect(isDayClosedForBooking(days, "2026-09-12", null)).toBe(true); // 上限
  });

  it("🔴 上限で閉まった日は、そこに自分の予約があれば開く", () => {
    // これが今回の要望そのもの。DB は自分を除いて数えるので通る
    expect(isDayClosedForBooking(days, "2026-09-12", "2026-09-12")).toBe(false);
  });

  it("🔴 手で止めた日は、自分の予約があっても開かない", () => {
    // 開けると「押せたのに GB007 で断られる」になる
    expect(isDayClosedForBooking(days, "2026-09-10", "2026-09-10")).toBe(true);
  });

  it("別の日から動かしてくる場合は、上限の日は閉まったまま", () => {
    // 自分を除いても上限のまま。DB も断る
    expect(isDayClosedForBooking(days, "2026-09-12", "2026-09-11")).toBe(true);
  });

  it("閉まっていない日は、どの場合でも開いている", () => {
    for (const from of [null, "2026-09-11", "2026-09-12"]) {
      expect(isDayClosedForBooking(days, "2026-09-11", from), String(from)).toBe(false);
    }
  });

  it("空・null でも落ちない", () => {
    expect(isDayClosedForBooking(null, "2026-09-12", "2026-09-12")).toBe(false);
    expect(isDayClosedForBooking([], "2026-09-12", null)).toBe(false);
  });
});

describe("🔴 画面の例外が DB の判定と一致している", () => {
  // 🔴 いちばん新しい定義を見る。20260901000000 の tenant_day_closed は4引数だが、
  //    体験予約を上限から外したときに3引数へ作り直されている（TRIAL_EXEMPT）。
  //    古いほうを見ると、いま動いていない定義に対して検査してしまう。
  const sql = readSql(TRIAL_EXEMPT);

  it("DB は「動かす予約自身」を除いて数える", () => {
    // ここが無いと、画面だけ開けても DB が GB007 で断る
    expect(sql).toMatch(/tenant_day_closed\s*\([^)]*p_exclude_booking_id/);
    expect(sql).toMatch(/tenant_day_booking_count\s*\([^)]*p_exclude_booking_id/);
  });

  it("トリガーが自分の id を渡している", () => {
    expect(sql).toMatch(/tenant_day_closed\(NEW\.tenant_id, v_date, NEW\.id\)/);
  });

  it("手で止めた日は除外と無関係に閉まる（booking_closed_days を先に見ている）", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.tenant_day_closed"));
    const closedIdx = fn.indexOf("booking_closed_days");
    const limitIdx = fn.indexOf("daily_booking_limit");
    expect(closedIdx, "booking_closed_days の判定が見つからない").toBeGreaterThan(0);
    expect(closedIdx, "手で止めた日の判定が上限より先に来ていること").toBeLessThan(limitIdx);
  });

  it("画面が両方の場所で予約変更の日を渡している", () => {
    const code = readCode(CUSTOMER);
    // カレンダーの disabled と、選択済みの日の受け皿
    const calls = code.match(/isDayClosedForBooking\([^)]*rescheduleFromDate\)/g) ?? [];
    expect(calls.length, "片方だけだと、押せても枠が0件のままになる").toBe(2);
    expect(code).toContain("const rescheduleFromDate = rescheduleTarget?.date ?? null;");
  });
});
