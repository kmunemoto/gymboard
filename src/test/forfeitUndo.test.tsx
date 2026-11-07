import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { SAME_DAY_FORFEIT_STATUS } from "@/lib/bookingStatus";
import { undoBookingForfeit } from "@/hooks/bookingForfeitUndo";
import ForfeitedBookingRow from "@/components/trainer/clientDetail/ForfeitedBookingRow";

// 消化扱いにした当日キャンセルを、あとから店側で「消化なし」に戻す（2026-11-07）。
//
// 宗本さん「お店側で当日キャンセルして、一回消費をえらんで当日キャンセルしてしまった予約を、
//          やっぱり一回消費扱いにしないように後からできる機能欲しい」
//
// 消化しないキャンセルはもともと予約の行を消す（cancelBooking の forfeit なし）ので、取り消しも
// 「今も消化扱いの行だけ」を消す。お客様へ通知はしない。画面は顧客の詳細「予約」タブ、ボタンはオーナーだけ。
//
// 本番の DB で確かめたこと（2026-11-07・巻き戻し済み）:
//   オーナー … 消せる（RETURNING も返る）。2回目は 0 行。booking_notify_log に 'removed'（操作した人つき）
//   お客様 …… 23514「消化扱いの予約は削除できません。」（enforce_booking_same_day_delete）
//   先生 ……… DB は通す（予約を消す権限はもともとある）。ボタンを出さないだけ
//
// ── 変異テスト（2026-11-07 実施・どれも赤を確認）──────────────────────────
//   1. status の条件を外す（消化でない予約まで消せる）            → 赤
//   2. 0 行（もう消化でない）を成功として扱う                      → 赤
//   3. 先生にもボタンを出す（canUndo を見ない）                     → 赤
//   4. 失敗しても一覧を読み直して閉じる                            → 赤
//   5. 顧客の詳細で、消化でない予約にも印を出す                     → 赤

// ── モック ───────────────────────────────────────────────────────────────
const calls: string[] = [];
const result = { current: { data: [{ id: "b-1" }] as unknown[] | null, error: null as unknown } };
const toasts: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(`from:${table}`);
      const chain = {
        delete: () => { calls.push("delete"); return chain; },
        update: () => { calls.push("update"); return chain; },
        eq: (col: string, val: unknown) => { calls.push(`eq:${col}=${String(val)}`); return chain; },
        select: (cols: string) => { calls.push(`select:${cols}`); return Promise.resolve(result.current); },
      };
      return chain;
    },
    functions: {
      invoke: (name: string) => { calls.push(`invoke:${name}`); return Promise.resolve({ data: null, error: null }); },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toasts.push(`ok:${m}`),
    error: (m: string) => toasts.push(`ng:${m}`),
  },
}));

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  result.current = { data: [{ id: "b-1" }], error: null };
});
afterEach(cleanup);

// ── 取り消しの処理 ─────────────────────────────────────────────────────
describe("undoBookingForfeit", () => {
  it("今も消化扱いの行だけを消す（status の条件つき）。お客様への通知は送らない", async () => {
    const res = await undoBookingForfeit("b-1");
    expect(res).toEqual({ error: null });
    expect(calls).toEqual([
      "from:bookings",
      "delete",
      "eq:id=b-1",
      `eq:status=${SAME_DAY_FORFEIT_STATUS}`,
      "select:id",
    ]);
    expect(calls.some((c) => c.startsWith("invoke:"))).toBe(false);
    expect(calls).not.toContain("update");
  });

  it("0 行（別の画面で先に取り消した・もう消化でない）なら gone。成功にしない", async () => {
    result.current = { data: [], error: null };
    expect(await undoBookingForfeit("b-1")).toEqual({ error: null, gone: true });
    result.current = { data: null, error: null };
    expect(await undoBookingForfeit("b-1")).toEqual({ error: null, gone: true });
  });

  it("DB が断ったら、そのエラーを返す", async () => {
    const err = { code: "23514", message: "denied" };
    result.current = { data: null, error: err };
    expect(await undoBookingForfeit("b-1")).toEqual({ error: err });
  });

  it("キャンセルの処理（cancelBooking）を通さない＝キャンセルの通知を2回送らない", () => {
    // コメント（説明の中で cancelBooking に触れている）は落としてから見る
    const code = readFileSync("src/hooks/bookingForfeitUndo.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).toContain(".delete()");
    expect(code).not.toMatch(/cancelBooking|functions\.invoke|send[A-Z]\w*Notification/);
  });
});

// ── 顧客の詳細の行 ─────────────────────────────────────────────────────
describe("ForfeitedBookingRow（顧客の詳細「予約」タブ）", () => {
  const booking = { id: "b-1", date: "2026-11-07T06:00:00+00:00" }; // JST 15:00
  const undoButton = () => screen.getByRole("button", { name: i18n.t("clientDetail.forfeitUndo") });
  const openAndConfirm = async () => {
    fireEvent.click(undoButton());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: i18n.t("clientDetail.forfeitUndo") }));
    return dialog;
  };

  it("印はスタッフ全員に出し、取り消しのボタンはオーナー（canUndo）にだけ出す", () => {
    const { rerender } = render(<ForfeitedBookingRow booking={booking} canUndo={false} onChanged={vi.fn()} />);
    expect(screen.getByText(i18n.t("clientDetail.forfeitBadge"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: i18n.t("clientDetail.forfeitUndo") })).toBeNull();
    rerender(<ForfeitedBookingRow booking={booking} canUndo onChanged={vi.fn()} />);
    expect(undoButton()).toBeInTheDocument();
  });

  it("確認で日時（JST）を見せ、取り消したら成功を出して一覧を読み直す", async () => {
    const onChanged = vi.fn();
    render(<ForfeitedBookingRow booking={booking} canUndo onChanged={onChanged} />);
    fireEvent.click(undoButton());
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("15:00");
    expect(calls).toEqual([]); // 開いただけでは何もしない
    fireEvent.click(within(dialog).getByRole("button", { name: i18n.t("clientDetail.forfeitUndo") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(toasts).toEqual([`ok:${i18n.t("clientDetail.forfeitUndone")}`]);
    expect(calls).toContain(`eq:status=${SAME_DAY_FORFEIT_STATUS}`);
  });

  it("戻るを押したら何もしない", async () => {
    const onChanged = vi.fn();
    render(<ForfeitedBookingRow booking={booking} canUndo onChanged={onChanged} />);
    fireEvent.click(undoButton());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: i18n.t("common.back") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("もう消化でなかった（0 行）ら、その旨を出して一覧を読み直す", async () => {
    result.current = { data: [], error: null };
    const onChanged = vi.fn();
    render(<ForfeitedBookingRow booking={booking} canUndo onChanged={onChanged} />);
    await openAndConfirm();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(toasts).toEqual([`ng:${i18n.t("clientDetail.forfeitUndoGone")}`]);
  });

  it("失敗したら失敗を出し、確認を開いたまま・一覧は読み直さない（もう一度押せる）", async () => {
    result.current = { data: null, error: { code: "42501", message: "denied" } };
    const onChanged = vi.fn();
    render(<ForfeitedBookingRow booking={booking} canUndo onChanged={onChanged} />);
    const dialog = await openAndConfirm();
    await waitFor(() => expect(toasts).toEqual([`ng:${i18n.t("clientDetail.forfeitUndoFailed")}`]));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: i18n.t("clientDetail.forfeitUndo") })).not.toBeDisabled());
  });
});

// ── 顧客の詳細へのつなぎ方 ──────────────────────────────────────────────
describe("TrainerClientDetail のつなぎ方", () => {
  const src = readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8");

  it("消化扱いの予約にだけ出し、取り消しはオーナー（制限付きスタッフでない）だけ", () => {
    expect(src).toMatch(
      /\{b\.status === SAME_DAY_FORFEIT_STATUS && \(\s*<ForfeitedBookingRow booking=\{b\} canUndo=\{!isLimitedStaff\} onChanged=\{\(\) => setBookingsReload\(\(n\) => n \+ 1\)\} \/>/,
    );
    expect(src).toContain('import { SAME_DAY_FORFEIT_STATUS } from "@/lib/bookingStatus";');
  });

  it("取り消したあとに予約の一覧を読み直す（読み込みの依存に入っている）", () => {
    expect(src).toMatch(/\}, \[clientId, sessionMinutes, tenantPlans, bookingsReload\]\);/);
  });
});

// ── 文言 ────────────────────────────────────────────────────────────────
describe("文言", () => {
  const KEYS = ["forfeitBadge", "forfeitUndo", "forfeitUndoTitle", "forfeitUndoDesc", "forfeitUndone", "forfeitUndoFailed", "forfeitUndoGone"];

  it("5言語すべてにある。確認の文には日時（{{when}}）が入る", () => {
    const missing: string[] = [];
    for (const loc of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(readFileSync(`src/locales/${loc}.json`, "utf8"));
      for (const k of KEYS) if (!d.clientDetail?.[k]) missing.push(`${loc}: clientDetail.${k}`);
      if (d.clientDetail?.forfeitUndoDesc && !d.clientDetail.forfeitUndoDesc.includes("{{when}}")) missing.push(`${loc}: {{when}}`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
