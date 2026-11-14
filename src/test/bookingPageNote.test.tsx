/**
 * 「予約画面のご案内」（tenants.booking_page_note・2026-11-14）。
 *
 * 宗本さん「予約画面の一番上にも出せるようにして」。伝えたいのは「次回分のご予約も前もって取れる・
 * お支払いは毎回1回目のトレーニングの日」のような、予約を取る前に読んでほしいこと。
 *
 * 🔴 壊しやすいもの:
 *   1. 設定していない店にも出る（上流の例が他のジムのお客様に出る）
 *   2. 予約画面のいちばん上に出し忘れる／体験予約・ドロップイン（未ログインの公開ページ）に出す
 *   3. 長さの上限が DB の CHECK とズレる（画面で書けるのに保存できない）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { BOOKING_PAGE_NOTE_MAX, normalizeBookingPageNote } from "@/lib/bookingPageNote";
import BookingPageNote from "@/components/booking/BookingPageNote";
import { TENANT_VALUE_DEFAULTS, normalizeTenantRow, tenantOptionalColumnNames } from "@/lib/tenantColumns";

const tenantRef = { current: null as Record<string, unknown> | null };
const updates: unknown[] = [];
const refetch = vi.fn();

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (v: unknown) => {
        updates.push(v);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  },
}));

const NOTE = "お支払いは1回目の日にお願いします（テスト）";
const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  tenantRef.current = { id: "t1", gym_name: "テストジム", booking_page_note: NOTE };
  updates.length = 0;
  refetch.mockClear();
});
afterEach(cleanup);

describe("出す文", () => {
  it("前後の空白は落とす。空白だけ・未設定は出さない（null）", () => {
    expect(normalizeBookingPageNote(`  ${NOTE}\n`)).toBe(NOTE);
    expect(normalizeBookingPageNote("   \n ")).toBeNull();
    expect(normalizeBookingPageNote(null)).toBeNull();
    expect(normalizeBookingPageNote(undefined)).toBeNull();
  });

  it("上限を超えたぶんは切る（DB の CHECK で保存が落ちない）", () => {
    expect(normalizeBookingPageNote("あ".repeat(BOOKING_PAGE_NOTE_MAX + 10))!.length).toBe(BOOKING_PAGE_NOTE_MAX);
  });
});

describe("お客様に見える部品", () => {
  it("見出しと店の文を出す。改行もそのまま", () => {
    render(<BookingPageNote note={`${NOTE}\n2行目`} />);
    const box = screen.getByTestId("booking-page-note");
    expect(box.textContent).toContain(i18n.t("booking.pageNoteTitle"));
    expect(box.textContent).toContain(NOTE);
    expect(box.querySelector(".whitespace-pre-line")).toBeTruthy();
  });

  it("🔴 設定していない店では何も描かない", () => {
    const { container } = render(<BookingPageNote note={null} />);
    expect(container.innerHTML).toBe("");
    const blank = render(<BookingPageNote note="  " />);
    expect(blank.container.innerHTML).toBe("");
  });
});

describe("🔴 会員の予約画面のいちばん上に出す。公開ページには出さない", () => {
  it("予約画面の見出しのすぐ下・キャンセルについての案内より上", () => {
    const src = read("src/components/customer/CustomerBooking.tsx");
    const at = src.indexOf("<BookingPageNote note={tenant?.booking_page_note} />");
    expect(at).toBeGreaterThan(src.indexOf('{t("booking.title")}'));
    expect(at).toBeLessThan(src.indexOf('{cancelPolicy && policyShownAt("bookingTop") && ('));
    // 予約画面の中で、日時を選ぶ部品（PlanUsageCard など）より前
    expect(at).toBeLessThan(src.indexOf("<PlanUsageCard"));
  });

  it("体験予約・ドロップイン（未ログインの公開ページ）には出さない", () => {
    for (const f of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
      expect(read(f), f).not.toContain("BookingPageNote");
      expect(read(f), f).not.toContain("booking_page_note");
    }
  });

  it("設定は予約のルール（ご来店前のお願いの隣）", () => {
    const cards = read("src/components/trainer/VisitGuideCards.tsx");
    expect(cards).toContain("<BookingPageNoteCard />");
    expect(cards.indexOf("<PreVisitNoteCard />")).toBeLessThan(cards.indexOf("<BookingPageNoteCard />"));
    expect(read("src/components/trainer/TrainerGymSettings.tsx")).toContain("<VisitGuideCards />");
  });
});

describe("設定（予約のルール → 予約画面のご案内）", () => {
  const renderCard = async () => {
    const { default: BookingPageNoteCard } = await import("@/components/trainer/BookingPageNoteCard");
    return render(<BookingPageNoteCard />);
  };
  const field = () => screen.getByLabelText(i18n.t("settings.trainer.bookingPageNoteLabel")) as HTMLTextAreaElement;
  const save = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));

  it("今の文が入っていて、お客様に出る見本が出る", async () => {
    await renderCard();
    expect(field().value).toBe(NOTE);
    expect(screen.getByTestId("booking-page-note-preview").textContent).toContain(NOTE);
  });

  it("未設定なら空で、見本も出ない（例文は薄い文字だけで、保存されない）", async () => {
    tenantRef.current = { id: "t1", booking_page_note: null };
    await renderCard();
    expect(field().value).toBe("");
    expect(field().placeholder).toBe(i18n.t("settings.trainer.bookingPageNotePlaceholder"));
    expect(screen.queryByTestId("booking-page-note-preview")).toBeNull();
    expect(updates).toEqual([]);
  });

  it("保存すると前後の空白を落として書く", async () => {
    await renderCard();
    fireEvent.change(field(), { target: { value: `  ${NOTE}  ` } });
    save();
    await waitFor(() => expect(updates).toEqual([{ booking_page_note: NOTE }]));
  });

  it("🔴 空にして保存すると NULL（出さない）", async () => {
    await renderCard();
    fireEvent.change(field(), { target: { value: "  " } });
    save();
    await waitFor(() => expect(updates).toEqual([{ booking_page_note: null }]));
  });

  it("入力欄の上限は DB と同じ", async () => {
    await renderCard();
    expect(field().maxLength).toBe(BOOKING_PAGE_NOTE_MAX);
  });
});

describe("DB", () => {
  const SQL = read("supabase/migrations/20261114010000_booking_page_note.sql").replace(/--[^\n]*/g, "");

  it("NULL 可・既定なし（NULL＝出さない）。長さの上限は画面と同じ", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS booking_page_note text;/);
    expect(SQL).toContain(`CHECK (booking_page_note IS NULL OR char_length(booking_page_note) <= ${BOOKING_PAGE_NOTE_MAX})`);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.tenants/i);
  });

  it("🔴 公開ページ（未ログイン）へは届けない: get_tenant_public に足さない", () => {
    expect(SQL).not.toContain("get_tenant_public");
  });
});

describe("店の設定の読み込み（tenantColumns）", () => {
  it("取得する列に入っている。列が読めない環境の既定は「出さない」（null）", () => {
    expect(tenantOptionalColumnNames()).toContain("booking_page_note");
    expect(TENANT_VALUE_DEFAULTS.booking_page_note).toBeNull();
    expect(normalizeTenantRow({ id: "t1" }).booking_page_note).toBeNull();
  });
});

describe("文言（5言語）", () => {
  const KEYS = [
    "bookingPageNoteLabel", "bookingPageNoteDesc", "bookingPageNotePlaceholder", "bookingPageNoteSaved", "bookingPageNoteSaveFailed",
  ];
  it("見出しと設定の文言が5言語そろっている。例は上限に収まる", () => {
    for (const l of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const j = JSON.parse(read(`src/locales/${l}.json`));
      expect(j.booking.pageNoteTitle, `${l} pageNoteTitle`).toBeTruthy();
      for (const k of KEYS) expect(j.settings.trainer[k], `${l} ${k}`).toBeTruthy();
      expect(j.settings.trainer.bookingPageNotePlaceholder.length, l).toBeLessThanOrEqual(BOOKING_PAGE_NOTE_MAX);
    }
  });
});
