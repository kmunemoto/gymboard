import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  OPTION_BLOCKED_SQLSTATE,
  isOptionBlockedError,
  summarizeOptions,
  type BookingOptionSnapshot,
} from "@/lib/bookingOptions";

// あとからオプションを足す（店側）と、予定表での見え方を見張る（2026-09-03）。
//
// ── なぜトリガーが要るのか ─────────────────────────────────────────
// 重複判定（check_booking_overlap）は **BEFORE INSERT にしか刺さっていない**。
// 「あとからオプションを足す」は UPDATE で占有だけを伸ばす操作なので、
// 専用のガードが無いと**何の検査も通らない**。60分の予約に30分を足すと、
// 予定表の上では黙って105分に伸び、すでに入っている次のお客様の枠を飲み込む。
// 画面には2件が重なって表示され、当日まで誰も気づかない。
//
// ── いちばん危ない壊し方 ───────────────────────────────────────────
// このガードは **bookings への BEFORE UPDATE** に刺さる。つまり
// キャンセル・消化・メモ追記・担当変更の**すべての UPDATE がここを通る**。
// 「増えていないなら即 RETURN」を消すと、予約のキャンセルまで巻き添えで落ちる。

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

const GUARD = "supabase/migrations/20260904000000_booking_option_update_guard.sql";
const SCHEDULE = "src/components/trainer/TrainerSchedule.tsx";
const DIALOG = "src/components/trainer/BookingOptionEditDialog.tsx";
const EDIT = "src/hooks/bookingOptionEdit.ts";
const TIMELINE = "src/components/trainer/WeekTimelineView.tsx";

const snap = (o: Partial<BookingOptionSnapshot> & { name: string }): BookingOptionSnapshot => ({
  id: "x", duration_minutes: 30, price_yen: 3000, ...o,
});

describe("🔴 伸ばす UPDATE を見るトリガー", () => {
  const sql = readSql(GUARD);

  it("bookings の BEFORE UPDATE に刺さっている", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_guard_booking_option_change\s*\n\s*BEFORE UPDATE ON public\.bookings/,
    );
  });

  it("🔴 増えていない UPDATE は即 RETURN（消すとキャンセルまで落ちる）", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.guard_booking_option_change"));
    expect(fn).toMatch(/IF v_new_option <= v_old_option THEN\s*\n\s*RETURN NEW;/);
    // その判定が、重い検査より**前**にあること
    expect(fn.indexOf("v_new_option <= v_old_option")).toBeLessThan(fn.indexOf("resolve_booking_capacity"));
  });

  it("キャンセル済みの予約は枠を持たないので素通し", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.guard_booking_option_change"));
    expect(fn).toMatch(/IF NEW\.status = 'キャンセル済み' THEN\s*\n\s*RETURN NEW;/);
  });

  it("占有は 1枠＋オプション＋間（間は1回だけ）", () => {
    expect(sql).toContain("new_session_min + v_new_option + COALESCE(buffer_min, 15)");
  });

  it("自分自身は数えない（数えると必ず自分と衝突して永久に足せない）", () => {
    expect(sql).toContain("b.id IS DISTINCT FROM NEW.id");
  });

  it("予約・体験・ブロック枠の3種すべてを見る", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.guard_booking_option_change"));
    expect(fn).toContain("FROM public.bookings b");
    expect(fn).toContain("FROM public.trial_bookings tb");
    expect(fn).toContain("FROM public.blocked_slots");
  });

  it("既存の予約側のオプションも足して比べる", () => {
    expect(sql).toContain("COALESCE(b.option_minutes, 0)");
  });

  it("同時受け入れ数（時間帯の帯）を見る", () => {
    expect(sql).toContain("public.resolve_booking_capacity(NEW.tenant_id, NEW.booking_date)");
    expect(sql).toContain("overlap_count >= capacity_limit");
  });

  it("担当が埋まる場合も拒否する", () => {
    expect(sql).toContain("staff_conflict_count > 0");
  });

  it(`SQLSTATE は ${OPTION_BLOCKED_SQLSTATE}（この用途専用）`, () => {
    expect(sql).toContain(`USING ERRCODE = '${OPTION_BLOCKED_SQLSTATE}'`);
    // 満枠の文言（Edge Function が文言一致で判定している経路がある）と同じ文にしない。
    // ⚠️ 文言はここに書かず**実物から引く**。書くと、業種フォークが文言を
    //    オーバーレイした瞬間にこのテストが落ちる（forkHostileTests の規約）。
    const overlapMsg = readSql("supabase/migrations/20260903000000_booking_option_minutes.sql")
      .match(/RAISE EXCEPTION '([^']+)'/)?.[1];
    expect(overlapMsg, "満枠の文言を取り出せていない（検査が空振りしている）").toBeTruthy();
    expect(sql).not.toContain(overlapMsg as string);
  });
});

describe("店側の変更画面", () => {
  const dialog = readCode(DIALOG);
  const edit = readCode(EDIT);

  it("予定表から開ける（予約をタップ → オプションを変更）", () => {
    const src = readCode(SCHEDULE);
    expect(src).toContain("bookingOptions.editOpen");
    expect(src).toContain("<BookingOptionEditDialog");
    expect(src).toContain("setOptionTarget");
  });

  it("ブロック枠には出さない（オプションの概念が無い）", () => {
    const src = readCode(SCHEDULE);
    expect(src).toContain("deleteTarget && !deleteTarget.isBlocked");
  });

  it("🔴 可否は DB に任せる（画面で先回りして判定しない）", () => {
    // 画面が持つ予約一覧はその日ぶんだけで、帯もブロック枠も含んだ正しい判定はできない
    expect(dialog).not.toContain("checkSlotBlocked");
    expect(dialog).toContain("isOptionBlockedError(error)");
  });

  it("🔴 断られた理由は SQLSTATE で見分ける（文言一致にしない）", () => {
    expect(dialog).toContain("bookingOptions.editBlocked");
    expect(dialog).not.toContain("後ろが空いていない");
  });

  it("保存できたら予定表を取り直す", () => {
    expect(readCode(SCHEDULE)).toContain("onSaved={() => refetch()}");
  });

  it("長さが変わるのでGoogleカレンダーを作り直す", () => {
    expect(edit).toContain('action: "delete"');
    expect(edit).toContain('action: "create"');
    expect(edit).toContain("option_minutes: minutes,");
  });

  it("外したときは控えを null に戻す（「付いていない」の表現を1つにする）", () => {
    expect(edit).toContain("bookingOptions.length > 0 ? bookingOptions : null");
  });

  it("お客様側からは呼べる導線を作っていない", () => {
    const customer = readCode("src/components/customer/CustomerBooking.tsx");
    expect(customer).not.toContain("updateBookingOptions");
    expect(customer).not.toContain("BookingOptionEditDialog");
  });
});

describe("🔴 変えたらお客様に知らせる（宗本さん 2026-09-03「通知を足して」）", () => {
  const edit = readCode(EDIT);

  it("プッシュとメールの2本で送る", () => {
    // プッシュだけにしない。許可していないお客様には何も届かないので、
    // メールが唯一の控えになる（キャンセル通知と同じ考え方）。
    expect(edit).toContain('invoke("send-push-notification"');
    expect(edit).toContain('invoke("send-transactional-email"');
    expect(edit).toContain('templateName: "booking-option-changed"');
  });

  it("宛先はお客様本人（店ではない。変えたのは店なので知らせる必要が無い）", () => {
    expect(edit).toContain("user_ids: [userId]");
    expect(edit).toContain('recipientEmail: "_resolve_user_"');
    expect(edit).toContain("resolveUserId: userId");
  });

  it("🔴 中身が変わっていないときは送らない（同じものを選び直して保存しただけ）", () => {
    expect(edit).toContain("if (changed) await notifyCustomer(");
    expect(edit).toContain("readOptionMinutes(row.option_minutes) !== minutes");
  });

  it("🔴 過ぎた予約には送らない（記録の手直しであって連絡ではない）", () => {
    expect(edit).toMatch(/new Date\(bookingDate\)\.getTime\(\) < Date\.now\(\)[\s\S]{0,20}return/);
  });

  it("同じ内容を2回押しても2通にならない（外して付け直したときは送る）", () => {
    // 鍵に分数と中身の両方を入れる
    expect(edit).toContain("const key = `option-change-${row.id}-${minutes}-${options.map((o) => o.id).sort().join(\",\")}`");
    expect(edit).toContain("idempotencyKey: key");
    expect(edit).toContain("tag: key");
  });

  it("知らせる時間帯は変更後のもの（1枠＋オプション。間は入れない）", () => {
    expect(edit).toContain("sessionMinutes(slotMinutes, minutes)");
    // 間（buffer）を足していない
    expect(edit).not.toContain("booking_buffer_minutes");
  });

  it("外したときは「取り消しました」と言う（何も出ないと何が起きたか分からない）", () => {
    expect(edit).toContain("const removed = options.length === 0");
    const tpl = readFileSync(
      "supabase/functions/_shared/transactional-email-templates/booking-option-changed.tsx", "utf8");
    expect(tpl).toContain("options.length === 0");
    expect(tpl).toContain("取り消しました");
  });

  it("メールのテンプレートが登録されている（登録漏れは「Template not found」で静かに落ちる）", () => {
    const registry = readFileSync(
      "supabase/functions/_shared/transactional-email-templates/registry.ts", "utf8");
    expect(registry).toContain("'booking-option-changed': bookingOptionChanged");
    expect(registry).toContain("from './booking-option-changed.tsx'");
  });

  it("クライアントから呼べる許可リストに入っている", () => {
    const fn = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
    const m = fn.match(/CLIENT_ALLOWED_TEMPLATES = new Set\(\[([\s\S]*?)\]\)/);
    expect(m?.[1]).toContain("booking-option-changed");
  });

  it("送信に失敗しても予約の変更自体は成立させる（fire-and-forget）", () => {
    expect(edit).toContain('.catch((e) => console.error("オプション変更のプッシュ送信に失敗:", e))');
    expect(edit).toContain('.catch((e) => console.error("オプション変更のメール送信に失敗:", e))');
  });
});

describe("予定表での見え方", () => {
  it("週グリッドと日別カードには**名前**を出す", () => {
    const src = readCode(SCHEDULE);
    expect(src).toContain('<BookingOptionLine options={session.bookingOptions} variant="grid" />');
    expect(src).toContain('<BookingOptionLine options={booking.bookingOptions} variant="card" />');
  });

  it("🔴 週タイムライン（既定のビュー）は狭いので色と印で区別する", () => {
    const src = readCode(TIMELINE);
    expect(src).toContain("hasOptions");
    // 色だけに頼らない（色覚・画面の明るさで区別できない人がいる）
    expect(src).toContain("border-l-4");
    expect(src).toContain('aria-hidden="true"');
    // 名前はツールチップに入れる
    expect(src).toContain("optionText");
  });

  it("オプションが無い予約は今までどおり何も出さない", () => {
    expect(summarizeOptions([], () => "")).toBe("");
    expect(summarizeOptions(null, () => "")).toBe("");
    expect(summarizeOptions(undefined, () => "")).toBe("");
  });

  it("1行の作り方（時間が増えないオプションには分数を付けない）", () => {
    const label = (m: number) => `+${m}分`;
    expect(summarizeOptions([snap({ name: "ストレッチ相当" })], label)).toBe("ストレッチ相当（+30分）");
    expect(summarizeOptions([snap({ name: "飲み物", duration_minutes: 0 })], label)).toBe("飲み物");
    expect(
      summarizeOptions([snap({ name: "A" }), snap({ name: "B", duration_minutes: 0 })], label),
    ).toBe("A（+30分）／B");
  });
});

describe("GB008 の見分け", () => {
  it("GB008 だけを拾う", () => {
    expect(isOptionBlockedError({ code: "GB008" })).toBe(true);
    expect(isOptionBlockedError({ code: "GB007" })).toBe(false);
    expect(isOptionBlockedError({ code: "GB001" })).toBe(false);
    expect(isOptionBlockedError(null)).toBe(false);
    expect(isOptionBlockedError("GB008")).toBe(false);
  });

  it("他のコードと重なっていない", () => {
    expect(["GB001", "GB002", "GB003", "GB004", "GB006", "GB007"]).not.toContain(
      OPTION_BLOCKED_SQLSTATE,
    );
  });
});

describe("文言（5言語）", () => {
  const KEYS = [
    "editOpen", "editTitle", "editSubject", "editNoOptions",
    "editLengthenNote", "editSaved", "editFailed", "editBlocked", "editBlockedHelp",
  ];
  for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"] as const) {
    it(`${lang} にオプション変更の文言がそろっている`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      for (const k of KEYS) {
        expect(json.bookingOptions[k], `${lang} bookingOptions.${k}`).toBeTruthy();
      }
    });
  }
});

describe("進捗バッジの写しを1つにした（この PR での整理）", () => {
  it("予定表が同じ即時関数を2回書いていない", () => {
    const src = readCode(SCHEDULE);
    expect(src).not.toContain("isGraceCarryover={p.isGraceCarryover}");
    expect(src.match(/<BookingProgressBadge/g)?.length ?? 0).toBe(2);
  });
});
