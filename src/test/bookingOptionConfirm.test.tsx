import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import i18n from "@/lib/i18n";
import BookingOptionConfirm from "@/components/booking/BookingOptionConfirm";
import type { BookingOption } from "@/lib/bookingOptions";

// 確認カードの中の「オプションを付けますか？」欄を、実際に描いて操作して見張る。
//
// ── なぜ本文検査ではなくここまでやるか（2026-09-03）────────────────────
// この欄が存在すること自体が要件（宗本さん「オプションが分かりづらい、これは気づかない。
// …確認の時にオプションを付けるか聞くようにしてください」）。文字列の有無を見る検査では
// 「置いてあるが押しても何も起きない」「付けられないのに逃げ道が出ない」を1つも
// 捕まえられない。ここでは押した結果を見る。
//
// 🔴 とくに大事なのは**逃げ道**。付けられない枠で「◯◯に変更して付ける」しか出さないと、
//    別の時間に動きたくないお客様がそこで止まり、60分の予約ごと落ちる。

const STRETCH: BookingOption = {
  id: "opt-1",
  name: "AddOnAlpha",
  duration_minutes: 30,
  price_yen: 3000,
};
const SECOND: BookingOption = {
  id: "opt-2",
  name: "AddOnBeta",
  duration_minutes: 15,
  price_yen: 0,
};

const onToggle = vi.fn();
const onMoveTo = vi.fn();
const onBookWithout = vi.fn();

const setup = (over: Partial<React.ComponentProps<typeof BookingOptionConfirm>> = {}) =>
  render(
    <BookingOptionConfirm
      options={[STRETCH]}
      selectedIds={[]}
      onToggle={onToggle}
      selectedTime="21:30"
      notFitReason={null}
      suggestTime={null}
      onMoveTo={onMoveTo}
      onBookWithout={onBookWithout}
      {...over}
    />,
  );

beforeEach(() => {
  onToggle.mockClear();
  onMoveTo.mockClear();
  onBookWithout.mockClear();
});
afterEach(cleanup);

describe("オプションが1つの店（いちばん多い形）は2択のタイル", () => {
  it("店にオプションが1つも無ければ何も出さない", () => {
    const { container } = setup({ options: [] });
    expect(container.textContent).toBe("");
  });

  it("名前・追加時間・料金が出る", () => {
    setup();
    expect(screen.getByText("AddOnAlpha")).toBeTruthy();
    expect(screen.getByText(i18n.t("bookingOptions.pickerPlusMinutes", { count: 30 }))).toBeTruthy();
    expect(screen.getByText(i18n.t("bookingOptions.pickerPrice", { price: "3,000" }))).toBeTruthy();
  });

  it("はじめは「付けない」が選ばれている（3,000円が黙って乗らない）", () => {
    setup();
    expect(screen.getByTestId("booking-option-none").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("booking-option-tile").getAttribute("aria-pressed")).toBe("false");
  });

  it("「付ける」を押すと ON になる", () => {
    setup();
    fireEvent.click(screen.getByTestId("booking-option-tile"));
    expect(onToggle).toHaveBeenCalledWith("opt-1");
  });

  it("「付けない」を押すと OFF になる", () => {
    setup({ selectedIds: ["opt-1"] });
    fireEvent.click(screen.getByTestId("booking-option-none"));
    expect(onToggle).toHaveBeenCalledWith("opt-1");
  });

  it("🔴 既に ON のときに「付ける」を押しても OFF にしない（押し間違いで外れる）", () => {
    setup({ selectedIds: ["opt-1"] });
    fireEvent.click(screen.getByTestId("booking-option-tile"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("🔴 既に OFF のときに「付けない」を押しても ON にしない", () => {
    setup();
    fireEvent.click(screen.getByTestId("booking-option-none"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("料金を設定していないオプションは金額を出さない（0 は「無料」ではない）", () => {
    setup({ options: [SECOND] });
    expect(screen.queryByText(i18n.t("bookingOptions.pickerPrice", { price: "0" }))).toBeNull();
  });
});

describe("オプションが複数ある店はチェックの行", () => {
  it("行の数だけ出て、それぞれ独立に切り替わる", () => {
    setup({ options: [STRETCH, SECOND], selectedIds: ["opt-1"] });
    const rows = screen.getAllByTestId("booking-option-row");
    expect(rows).toHaveLength(2);
    expect(screen.queryByTestId("booking-option-tile")).toBeNull();
  });
});

describe("🔴 付けられないとき", () => {
  const notFit = { selectedIds: ["opt-1"], notFitReason: "occupied" as const };

  it("何も選んでいなければ案内は出ない", () => {
    setup({ notFitReason: "occupied" });
    expect(screen.queryByTestId("booking-option-keep")).toBeNull();
  });

  it("🔴 一文目は「この枠はダメ」ではなく「トレーニングは取れる」", () => {
    // 以前 ON にしたまま忘れている人が赤い警告を見ると、枠自体が取れないと誤解して
    // 別の枠を探し回る（実際にはトレーニングだけなら取れる）。
    setup(notFit);
    expect(screen.getByText(i18n.t("bookingOptions.notFitTitle", { time: "21:30" }))).toBeTruthy();
  });

  it("理由は「空きが足りない」と「営業時間を過ぎる」で書き分ける", () => {
    setup(notFit);
    expect(screen.getByText(i18n.t("bookingOptions.notFitOccupied", { name: "AddOnAlpha" }))).toBeTruthy();
    cleanup();
    setup({ selectedIds: ["opt-1"], notFitReason: "hours" });
    expect(screen.getByText(i18n.t("bookingOptions.notFitHours", { name: "AddOnAlpha" }))).toBeTruthy();
  });

  it("🔴 早める先があれば、その時刻のボタンを出す（文字で「早めてください」と言わない）", () => {
    setup({ ...notFit, suggestTime: "21:00" });
    const move = screen.getByTestId("booking-option-move");
    expect(move.textContent).toBe(i18n.t("bookingOptions.notFitMove", { time: "21:00", name: "AddOnAlpha" }));
    fireEvent.click(move);
    expect(onMoveTo).toHaveBeenCalledWith("21:00");
  });

  it("🔴 逃げ道は必ず出す（早める先があってもなくても）", () => {
    // ここが無いと、別の時間に動きたくないお客様が止まり、60分の予約ごと落ちる。
    setup({ ...notFit, suggestTime: "21:00" });
    fireEvent.click(screen.getByTestId("booking-option-keep"));
    expect(onBookWithout).toHaveBeenCalledTimes(1);
    cleanup();
    setup({ ...notFit, suggestTime: null });
    expect(screen.getByTestId("booking-option-keep")).toBeTruthy();
  });

  it("早める先が無ければ、その旨を出してボタンは出さない", () => {
    setup({ ...notFit, suggestTime: null });
    expect(screen.queryByTestId("booking-option-move")).toBeNull();
    expect(screen.getByText(i18n.t("bookingOptions.notFitNone", { name: "AddOnAlpha" }))).toBeTruthy();
  });

  it("複数付けているときは名前を並べて出す", () => {
    setup({
      options: [STRETCH, SECOND], selectedIds: ["opt-1", "opt-2"],
      notFitReason: "occupied", suggestTime: "21:00",
    });
    expect(screen.getByTestId("booking-option-move").textContent).toContain("AddOnAlpha・AddOnBeta");
  });

  it("送信中は全部押せない（二重送信を防ぐ）", () => {
    setup({ ...notFit, suggestTime: "21:00", disabled: true });
    expect(screen.getByTestId("booking-option-move")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("booking-option-keep")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("booking-option-none")).toHaveProperty("disabled", true);
  });
});
