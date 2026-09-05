import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { proxyBookingErrorKey } from "@/lib/bookingErrors";
import {
  isBlockedStart,
  isBlockedWindowError,
  matchesBlockedWindow,
  type BookingBlockedWindow,
} from "@/lib/bookingBlockedWindows";

// 受付しない時間帯（「平日は 18:15 の回と 19:30 の回だけを残す」等）の規則を見張る。
//
// 守るべき不変条件:
//   1. 🔴 帯は**開区間 (start, end)** —— 両端ちょうどの開始は受け付ける。
//      両端こそが「残したい2枠」そのもの（閉区間にすると店は残したい枠自体を塞ぐ）。
//      区間規則は機能ごとに違う: 容量の帯 [s,e) / 回数の制限 [s,e] / この帯 (s,e)
//   2. 🔴 店側の代理予約には効かない（DBトリガーが auth.uid() = user_id だけを見る）
//   3. 🔴 免除（booking_frequency_limits.exempt）はこの帯より強い
//   4. クライアントの規則と DB トリガー（GB006）の規則が一致している

/** 平日 18:15〜19:30（実店舗の典型例。18:30〜19:15 開始を塞ぎ、18:15 と 19:30 は残す） */
const EVENING_GAP: BookingBlockedWindow = {
  weekdays: [1, 2, 3, 4, 5],
  start_time: "18:15",
  end_time: "19:30",
};

describe("帯のマッチング（開区間）", () => {
  it("🔴 両端ちょうどの開始には効かない（残したい2枠そのもの）", () => {
    expect(matchesBlockedWindow(EVENING_GAP, 5, 18 * 60 + 15)).toBe(false);  // 18:15 = 残す枠
    expect(matchesBlockedWindow(EVENING_GAP, 5, 19 * 60 + 30)).toBe(false);  // 19:30 = 残す枠
  });

  it("両端の間に始まる予約には効く", () => {
    expect(matchesBlockedWindow(EVENING_GAP, 5, 18 * 60 + 16)).toBe(true);   // 18:16
    expect(matchesBlockedWindow(EVENING_GAP, 5, 18 * 60 + 30)).toBe(true);   // 18:30
    expect(matchesBlockedWindow(EVENING_GAP, 5, 19 * 60)).toBe(true);        // 19:00（元の問題の枠）
    expect(matchesBlockedWindow(EVENING_GAP, 5, 19 * 60 + 15)).toBe(true);   // 19:15
    expect(matchesBlockedWindow(EVENING_GAP, 5, 19 * 60 + 29)).toBe(true);   // 19:29
  });

  it("帯の外・曜日の外には効かない", () => {
    expect(matchesBlockedWindow(EVENING_GAP, 5, 18 * 60)).toBe(false);       // 18:00
    expect(matchesBlockedWindow(EVENING_GAP, 5, 19 * 60 + 45)).toBe(false);  // 19:45
    expect(matchesBlockedWindow(EVENING_GAP, 6, 19 * 60)).toBe(false);       // 土曜
    expect(matchesBlockedWindow(EVENING_GAP, 0, 19 * 60)).toBe(false);       // 日曜
  });

  it("壊れた行は効かせない（DBが正）", () => {
    expect(matchesBlockedWindow({ ...EVENING_GAP, start_time: "あ" }, 5, 19 * 60)).toBe(false);
    expect(matchesBlockedWindow({ ...EVENING_GAP, weekdays: null as unknown as number[] }, 5, 19 * 60)).toBe(false);
  });

  it("isBlockedStart: どれかの帯に当たれば true・空/不明は false", () => {
    expect(isBlockedStart([EVENING_GAP], 5, 19 * 60)).toBe(true);
    expect(isBlockedStart([EVENING_GAP], 5, 18 * 60)).toBe(false);
    expect(isBlockedStart([], 5, 19 * 60)).toBe(false);
    expect(isBlockedStart(null, 5, 19 * 60)).toBe(false);
    expect(isBlockedStart([EVENING_GAP], null, 19 * 60)).toBe(false);
    expect(isBlockedStart([EVENING_GAP], 5, null)).toBe(false);
    // 複数の帯: どれか1つでも
    const morning: BookingBlockedWindow = { weekdays: [6], start_time: "09:00", end_time: "10:30" };
    expect(isBlockedStart([morning, EVENING_GAP], 6, 9 * 60 + 45)).toBe(true);
    expect(isBlockedStart([morning, EVENING_GAP], 6, 19 * 60)).toBe(false);  // 土曜は夜の帯の対象外
  });
});

describe("エラーの見分け", () => {
  it("GB006 だけを受付しない時間帯と判定する", () => {
    expect(isBlockedWindowError({ code: "GB006", message: "x" })).toBe(true);
    expect(isBlockedWindowError({ code: "GB003" })).toBe(false);   // 回数上限（案内が別）
    expect(isBlockedWindowError({ code: "GB004" })).toBe(false);
    expect(isBlockedWindowError({ message: "GB006" })).toBe(false); // 文言一致では判定しない
    expect(isBlockedWindowError(null)).toBe(false);
    expect(isBlockedWindowError("GB006")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB 側の規則がクライアントと一致していることを、migrations の SQL から見張る
// ---------------------------------------------------------------------------
// 🔴 検査は「連結全体」ではなく**最後の定義**に対して行う（CREATE OR REPLACE は
// 最後の定義しか残らないため。booking_frequency_limits のレビューで実証された穴）。
const migrationsDir = "supabase/migrations";
const blockedSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
  .filter((sql) =>
    /booking_blocked_windows|guard_booking_blocked_window|delete_my_gym/.test(sql))
  .join("\n")
  // 行末コメントも落とす（コード削除＋行末コメントに旧コードを残す変異を通さない）
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const lastFn = (name: string): string => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = blockedSql.lastIndexOf(marker);
  expect(at, `${name} の定義が見つからない`).toBeGreaterThanOrEqual(0);
  const rest = blockedSql.slice(at);
  const end = rest.search(/\$(function)?\$;/);
  return end >= 0 ? rest.slice(0, end) : rest;
};

describe("🔴 DB 側の規則がクライアントと一致している", () => {
  const guard = lastFn("guard_booking_blocked_window");
  // 免除の EXISTS（booking_frequency_limits）と帯の EXISTS（booking_blocked_windows）を
  // 切り分けてから見る（同じ変数名の比較が両方にあるため。GB003 のレビューと同じ手法）。
  const exemptAt = guard.indexOf("FROM public.booking_frequency_limits l");
  const blockAt = guard.indexOf("FROM public.booking_blocked_windows w");
  const exemptBlock = guard.slice(exemptAt, blockAt);
  const windowBlock = guard.slice(blockAt);

  it("テーブル・トリガー・関数の結線が定義されている", () => {
    expect(blockedSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_blocked_windows/);
    expect(blockedSql).toMatch(/EXECUTE FUNCTION public\.guard_booking_blocked_window\(\)/);
    expect(blockedSql).toMatch(
      /CREATE TRIGGER trg_guard_booking_blocked_window\s*\n\s*BEFORE INSERT OR UPDATE ON public\.bookings/,
    );
  });

  it("🔴 代理予約とサービスロールは素通しする（自己予約だけを見る）", () => {
    expect(guard).toMatch(/v_actor := auth\.uid\(\);/);
    expect(guard).toMatch(
      /IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW\.user_id THEN\s*\n\s*RETURN NEW;/,
    );
  });

  it("🔴 帯は開区間 —— 両端ちょうどの開始は受け付ける", () => {
    expect(blockAt, "帯の EXISTS が見つからない").toBeGreaterThan(-1);
    expect(windowBlock.length).toBeGreaterThan(0);
    expect(windowBlock).toMatch(/AND v_min > \(split_part\(w\.start_time/);
    expect(windowBlock).toMatch(/AND v_min < \(split_part\(w\.end_time/);
    // 閉区間（>= / <=）に化けていないこと（化けると店が残したい2枠まで塞がる）
    expect(windowBlock).not.toMatch(/v_min >= \(split_part\(w\.start_time/);
    expect(windowBlock).not.toMatch(/v_min <= \(split_part\(w\.end_time/);
    expect(windowBlock).toMatch(/AND w\.enabled\b/);
    expect(windowBlock).toMatch(/AND v_dow = ANY \(w\.weekdays\)/);
  });

  it("🔴 免除は帯より強い（帯の判定より前に評価し、当たれば素通し）", () => {
    expect(exemptAt, "免除の EXISTS が見つからない").toBeGreaterThan(-1);
    expect(exemptAt, "免除の判定が帯の判定より後にある").toBeLessThan(blockAt);
    // 免除の時間帯は制限側の規則（閉区間）のまま
    expect(exemptBlock).toMatch(/AND l\.exempt\b/);
    expect(exemptBlock).toMatch(/AND l\.user_id = NEW\.user_id/);
    expect(exemptBlock).toMatch(/AND v_min >= \(split_part\(l\.start_time/);
    expect(exemptBlock).toMatch(/AND v_min <= \(split_part\(l\.end_time/);
  });

  it("'キャンセル済み' からの復活は日時が変わらなくても判定する", () => {
    expect(guard).toMatch(
      /AND NOT \(OLD\.status = 'キャンセル済み' AND NEW\.status IS DISTINCT FROM 'キャンセル済み'\)/,
    );
    expect(guard).toMatch(/AND NEW\.booking_date IS NOT DISTINCT FROM OLD\.booking_date/);
  });

  it("曜日と時刻は JST で数える", () => {
    expect(guard).toMatch(/AT TIME ZONE 'Asia\/Tokyo'/);
    expect(guard).toMatch(/EXTRACT\(DOW FROM v_jst\)/);
  });

  it("SQLSTATE は GB006（GB003〜GB005 と混ぜない）", () => {
    expect(guard).toMatch(/USING ERRCODE = 'GB006'/);
  });

  it("RLS: RESTRICTIVE のテナント境界・anon の遮断・書き込みは店側のみ", () => {
    expect(blockedSql).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_blocked_windows AS RESTRICTIVE/);
    expect(blockedSql).toMatch(/REVOKE ALL ON public\.booking_blocked_windows FROM anon/);
    for (const kind of ["write", "update", "delete"]) {
      const defs = [...blockedSql.matchAll(
        new RegExp(`CREATE POLICY booking_blocked_windows_${kind}[\\s\\S]*?;`, "g"))];
      expect(defs.length, `${kind} ポリシーが見つからない`).toBeGreaterThanOrEqual(1);
      expect(defs[defs.length - 1][0]).toMatch(
        /has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/,
      );
    }
  });

  it("CHECK: 時刻の形式（実際に正規表現として評価する）・曜日・並び", () => {
    const startMatches = [...blockedSql.matchAll(/booking_blocked_windows_start_time_check\s*\n\s*CHECK \(start_time ~ '([^']+)'\)/g)];
    expect(startMatches.length).toBeGreaterThanOrEqual(1);
    const startRe = new RegExp(startMatches[startMatches.length - 1][1]);
    expect(startRe.test("18:15")).toBe(true);
    expect(startRe.test("24:00"), "開始に 24:00 は許さない").toBe(false);
    const endMatches = [...blockedSql.matchAll(/booking_blocked_windows_end_time_check\s*\n\s*CHECK \(end_time ~ '([^']+)'\)/g)];
    expect(endMatches.length).toBeGreaterThanOrEqual(1);
    const endRe = new RegExp(endMatches[endMatches.length - 1][1]);
    expect(endRe.test("19:30")).toBe(true);
    expect(endRe.test("24:00")).toBe(true);
    expect(endRe.test("25:00")).toBe(false);
    // 🔴 cardinality を使うこと。array_length('{}',1) は NULL で CHECK を素通りする
    expect(blockedSql).toMatch(/CHECK \(cardinality\(weekdays\) >= 1 AND weekdays <@ ARRAY\[0,1,2,3,4,5,6\]\)/);
    expect(blockedSql).toMatch(/CHECK \(end_time > start_time\)/);
  });

  it("テナント削除（delete_my_gym）の**最後の定義**がこの表も消す", () => {
    const gym = lastFn("delete_my_gym");
    expect(gym).toMatch(/DELETE FROM public\.booking_blocked_windows WHERE tenant_id = v_tenant_id/);
    // 既存の表の DELETE が落ちていないこと（1回の定義に全テーブルの決まり）
    expect(gym).toMatch(/DELETE FROM public\.booking_frequency_limits WHERE tenant_id = v_tenant_id/);
  });
});


/** migrations 連結から guard_booking_blocked_window の**最後の**定義を取り出す（CREATE OR REPLACE は最後しか残らない） */
function lastFnBlocked(): string {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const all = files.map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const marker = "CREATE OR REPLACE FUNCTION public.guard_booking_blocked_window";
  const at = all.lastIndexOf(marker);
  expect(at, "guard_booking_blocked_window の定義が見つからない").toBeGreaterThanOrEqual(0);
  const rest = all.slice(at);
  const end = rest.search(/\$function\$;/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

// ---------------------------------------------------------------------------
// 画面がこの仕組みを実際に使っていることを見張る
// ---------------------------------------------------------------------------
describe("🔴 画面が受付しない時間帯を見ている", () => {
  const customerBooking = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
  const trainerSchedule = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");

  it("お客様の予約画面は、枠の生成・送信直前・リスケ直前の3箇所で判定する", () => {
    expect(customerBooking).toContain("useBookingBlockedWindows(");
    expect(customerBooking).toContain("isBlockedWindowError(");
    const calls = (customerBooking.match(/isSlotNotAccepting\(/g) ?? []).length;
    expect(calls, "isSlotNotAccepting の呼び出しが3箇所より少ない").toBeGreaterThanOrEqual(3);
  });

  it("🔴 帯の枠は「満枠」と表示も挙動も完全に同一（2026-08-23 店の要望）", () => {
    // ラベルだけ揃えても、帯だけ押せない／文字が薄い／空き待ちに出せない、が同じ
    // グリッドに並ぶと「この時間だけ扱いが違う」と分かってしまう（実際に踏んだ）。
    // そこで表示層は displayBlocked（帯を「埋まっている」とみなす）1本に寄せてある。
    // 2026-09-03（第4段）にグリッドを BookingSlotGrid へ切り出したので、見るのはあちら。
    const grid = readFileSync("src/components/booking/BookingSlotGrid.tsx", "utf8");
    expect(grid, "帯を満枠と同一視する displayBlocked が無い").toMatch(
      /const displayBlocked = slot\.blocked \|\| slot\.notAccepting;/,
    );
    // 押せる/押せない・薄さ・空き待ちの可否を決める3箇所が、すべて displayBlocked を見る
    expect(grid, "空き待ちの判定が帯を別扱いしている").toMatch(
      /waitlistEnabled && !slot\.available && displayBlocked && !slot\.tooSoon && !slot\.overLimit;/,
    );
    // ⚠️ 2026-09-05 に、上限で埋まった当日も「見るだけ」に加えた（dayFull）。
    //    見るべきは **`&& !displayBlocked` が残っていること**＝帯は「空き」に戻らないこと。
    //    左側の条件が増えるのは想定内なので、そこは緩く見る。
    expect(grid, "締切後の帯が「空き」表示に戻っている").toMatch(
      /const viewOnlyOpen = \([^)]*slot\.tooSoon[^)]*\) && !displayBlocked;/,
    );
    expect(grid, "ラベルの分岐が帯を別扱いしている").toMatch(
      /\{slot\.overLimit && !displayBlocked/,
    );
    // 🔴 帯だけを名指しで別扱いする分岐が復活していないこと（ラベル・見た目・空き待ちの
    //    どれか1つでも slot.notAccepting で分岐すると、そこだけ満枠と違う挙動になる）
    const namedBranches = (grid.match(/slot\.notAccepting/g) ?? []).length;
    expect(namedBranches, "slot.notAccepting は displayBlocked の定義1箇所だけであるべき").toBe(1);
    expect(grid, "受付外の専用ラベルが復活している").not.toContain("slotNotAccepting");
  });

  it("🔴 帯の存在がお客様向けの文言に漏れない（すべて満枠の体裁）", () => {
    // クライアントのエラー文言（単発・定期・リスケの GB006 分岐が全部この1キーを使う）
    // 🔴 否定と肯定の両建てで見る。否定だけだと「受け付けていません」（受付の2文字が
    //    連続しない）をすり抜ける——変異検証で実際にすり抜けた穴。
    const fullWording: Record<string, RegExp> = {
      ja: /満枠/,
      en: /fully booked/i,
      ko: /만석/,
      "zh-CN": /约满/,
      "zh-TW": /約滿/,
    };
    for (const [lang, full] of Object.entries(fullWording)) {
      const d = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      const bw = d.blockedWindows;
      expect(bw.errorNotAccepting, `${lang}: 満枠の語が入っていない`).toMatch(full);
      expect(bw.errorNotAccepting, `${lang}: 受付しない旨が漏れている`).not.toMatch(
        /受付|受け付け|not accept|접수|受理/i,
      );
      // 消したキーが復活していない（復活すると grid や toast で使われ直すおそれ）
      expect(bw.slotNotAccepting, `${lang}: slotNotAccepting が復活`).toBeUndefined();
      expect(bw.repeatSkippedBlocked, `${lang}: repeatSkippedBlocked が復活`).toBeUndefined();
      // 店側向けの案内は明示のまま（お客様には出ない文言）
      expect(bw.errorNotAcceptingProxy, `${lang}: 店側向けの文言が消えた`).toBeTruthy();
    }
    // 定期予約のスキップ通知: 帯スキップは満枠スキップに合流（専用トーストを出さない）
    expect(customerBooking).not.toContain("repeatSkippedBlocked");
    // DB の GB006 メッセージ（旧クライアントにだけ届く）も満枠の体裁。ERRCODE は GB006 のまま
    const gb006 = lastFnBlocked();
    expect(gb006).toMatch(/RAISE EXCEPTION '[^']*満枠[^']*'/);
    expect(gb006).not.toMatch(/RAISE EXCEPTION '[^']*受け付けていません[^']*'/);
    expect(gb006).toMatch(/ERRCODE = 'GB006'/);
  });

  it("🔴 免除のお客様には帯を効かせない（免除は帯より強い）", () => {
    expect(customerBooking).toMatch(
      /if \(isExemptFromFrequencyLimits\(frequencyLimits, weekday, startMinutes, user\.id\)\) return false;/,
    );
  });

  it("🔴 店側の代理予約（TrainerSchedule）はクライアント判定を持たない", () => {
    // 効かせないのは仕様（帯の中に入れてあげるのは店の裁量）。DB 側の素通しとセット。
    expect(trainerSchedule).not.toContain("isBlockedStart(");
    // GB006 の文言分岐だけは持つ（トレーナーが自分をお客様として選んだときに出る）。
    // 判定は 2026-09-03 に src/lib/bookingErrors.ts へ1本化した。
    expect(trainerSchedule).toContain("proxyBookingErrorKey(error)");
    expect(proxyBookingErrorKey({ code: "GB006" })).toBe("blockedWindows.errorNotAcceptingProxy");
  });

  it("設定画面に編集セクションが載っている", () => {
    const gymSettings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    expect(gymSettings).toContain("<TrainerBlockedWindows />");
  });

  it("設定画面は 15分刻み・挿入→差分削除・読み込み失敗時は保存を塞ぐ", () => {
    const ui = readFileSync("src/components/trainer/TrainerBlockedWindows.tsx", "utf8");
    // 🔴 15分刻み（30分刻みだと「18:15 と 19:30 を残す」が設定できない）
    expect(ui).toMatch(/const total = i \* 15;/);
    expect(ui).toMatch(/\{ length: 96 \}/);
    // 挿入 → 差分削除の順（逆だと、削除成功後の挿入失敗で帯が全部静かに消える）
    const insertAt = ui.indexOf(".insert(rows as never)");
    const diffDeleteAt = ui.indexOf('.not("id", "in"');
    expect(insertAt).toBeGreaterThan(-1);
    expect(diffDeleteAt).toBeGreaterThan(insertAt);
    expect(ui).toMatch(/disabled=\{saving \|\| loading \|\| loadFailed\}/);
    // 両端は受け付ける、を行ごとに具体的な時刻で示す
    expect(ui).toContain('t("blockedWindows.rowHint", { start: w.start, end: w.end })');
  });

  it("読めない環境では空配列＝帯なしに倒す（予約を止めない）", () => {
    const hook = readFileSync("src/hooks/useBookingBlockedWindows.ts", "utf8");
    expect(hook).toMatch(/if \(error \|\| !data\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*setWindows\(\[\]\)/);
    expect(hook).toContain('.eq("enabled", true)');
  });

  it("types.ts に booking_blocked_windows が載っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/\n {6}booking_blocked_windows: \{/);
  });
});

// ---------------------------------------------------------------------------
// 5言語そろい（fallbackLng が ja なので欠けると日本語が出る）
// ---------------------------------------------------------------------------
describe("blockedWindows の5言語そろい", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"];
  const localeOf = (l: string) =>
    JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")) as Record<string, Record<string, string>>;

  it("全言語にキーがあり、日本語のままコピーされていない", () => {
    const ja = localeOf("ja").blockedWindows;
    expect(ja, "ja に blockedWindows が無い").toBeTruthy();
    const keys = Object.keys(ja);
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const l of LANGS.filter((x) => x !== "ja")) {
      const d = localeOf(l).blockedWindows;
      expect(d, `${l} に blockedWindows が無い`).toBeTruthy();
      for (const k of keys) {
        expect(d[k], `${l} に blockedWindows.${k} が無い`).toBeTruthy();
        expect(d[k], `${l} の blockedWindows.${k} が未翻訳`).not.toBe(ja[k]);
      }
    }
  });
});
