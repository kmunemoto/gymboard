/**
 * 「ご来店前のお願い」（tenants.pre_visit_note・2026-10-27）。
 *
 * 宗本さん「お客様にトレーニング前の１～２時間前にエネルギーになるものを摂取して
 * お越しくださいという意味の文章を伝えたい。そういうのを設定できる仕組みを考えて、作って」。
 * 出す場所は「アプリ内だけ」と確認済み。
 *
 * 🔴 壊しやすいもの:
 *   1. 設定していない店にも出る（上流の例文が他のジムのお客様に出る）
 *   2. 画面のどれかに出し忘れる（予約完了・ホームの次回の予約・体験予約の完了）
 *   3. 長さの上限が DB の CHECK とズレる（画面で書けるのに保存できない）
 *   4. 体験予約ページ（未ログイン）に届かない／get_tenant_public の GRANT を貼り直し忘れる
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { PRE_VISIT_NOTE_MAX, normalizePreVisitNote } from "@/lib/preVisitNote";
import PreVisitNote from "@/components/booking/PreVisitNote";
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

const NOTE = "1〜2時間前に軽く食べてからお越しください";

beforeEach(() => {
  tenantRef.current = { id: "t1", gym_name: "テストジム", pre_visit_note: NOTE };
  updates.length = 0;
  refetch.mockClear();
});
afterEach(cleanup);

describe("出す文", () => {
  it("前後の空白は落とす。空白だけ・未設定は出さない（null）", () => {
    expect(normalizePreVisitNote(`  ${NOTE}\n`)).toBe(NOTE);
    expect(normalizePreVisitNote("   \n ")).toBeNull();
    expect(normalizePreVisitNote(null)).toBeNull();
    expect(normalizePreVisitNote(undefined)).toBeNull();
  });

  it("上限を超えたぶんは切る（DB の CHECK で保存が落ちない）", () => {
    expect(normalizePreVisitNote("あ".repeat(PRE_VISIT_NOTE_MAX + 10))!.length).toBe(PRE_VISIT_NOTE_MAX);
  });
});

describe("お客様に見える部品", () => {
  it("見出しと店の文を出す。改行もそのまま", () => {
    render(<PreVisitNote note={`${NOTE}\nタオルもお持ちください`} />);
    const box = screen.getByTestId("pre-visit-note");
    expect(box.textContent).toContain(i18n.t("booking.preVisitTitle"));
    expect(box.textContent).toContain(NOTE);
    expect(box.querySelector(".whitespace-pre-line")).toBeTruthy();
  });

  it("🔴 設定していない店では何も描かない", () => {
    const { container } = render(<PreVisitNote note={null} />);
    expect(container.innerHTML).toBe("");
    const blank = render(<PreVisitNote note="  " />);
    expect(blank.container.innerHTML).toBe("");
  });
});

describe("🔴 3つの画面に出す（予約完了・ホームの次回の予約・体験予約の完了）", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("予約完了の画面", () => {
    expect(read("src/components/customer/BookingCompleteDialog.tsx")).toContain("<PreVisitNote note={tenant?.pre_visit_note} />");
  });

  it("ホームの次回の予約（小さめに）", () => {
    expect(read("src/components/customer/CustomerHome.tsx")).toContain("<PreVisitNote compact note={tenant.pre_visit_note} />");
  });

  it("体験予約の完了画面（未ログイン。get_tenant_public から受け取る）", () => {
    const trial = read("src/pages/TrialBooking.tsx");
    expect(trial).toContain("<PreVisitNote note={tenant?.pre_visit_note} />");
    expect(trial).toContain("pre_visit_note?: string | null;");
  });

  it("設定は予約のルール（来店の目安時刻の隣）", () => {
    expect(read("src/components/trainer/VisitGuideCards.tsx")).toContain("<PreVisitNoteCard />");
    expect(read("src/components/trainer/TrainerGymSettings.tsx")).toContain("<VisitGuideCards />");
  });
});

describe("設定（予約のルール → ご来店前のお願い）", () => {
  const renderCard = async () => {
    const { default: PreVisitNoteCard } = await import("@/components/trainer/PreVisitNoteCard");
    return render(<PreVisitNoteCard />);
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));

  it("今の文が入っていて、お客様に出る見本が出る", async () => {
    await renderCard();
    expect((screen.getByLabelText(i18n.t("settings.trainer.preVisitLabel")) as HTMLTextAreaElement).value).toBe(NOTE);
    expect(screen.getByTestId("pre-visit-preview").textContent).toContain(NOTE);
  });

  it("例文ボタンで例文が入る（保存するまでお客様には出ない）", async () => {
    tenantRef.current = { id: "t1", pre_visit_note: null };
    await renderCard();
    expect(screen.queryByTestId("pre-visit-preview")).toBeNull();
    fireEvent.click(screen.getByText(i18n.t("settings.trainer.preVisitUseTemplate")));
    expect((screen.getByLabelText(i18n.t("settings.trainer.preVisitLabel")) as HTMLTextAreaElement).value)
      .toBe(i18n.t("settings.trainer.preVisitTemplate"));
    expect(updates).toEqual([]);
  });

  it("保存すると前後の空白を落として書く", async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText(i18n.t("settings.trainer.preVisitLabel")), { target: { value: `  ${NOTE}  ` } });
    save();
    await waitFor(() => expect(updates).toEqual([{ pre_visit_note: NOTE }]));
  });

  it("🔴 空にして保存すると NULL（出さない）", async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText(i18n.t("settings.trainer.preVisitLabel")), { target: { value: "  " } });
    save();
    await waitFor(() => expect(updates).toEqual([{ pre_visit_note: null }]));
  });

  it("入力欄の上限は DB と同じ", async () => {
    await renderCard();
    expect((screen.getByLabelText(i18n.t("settings.trainer.preVisitLabel")) as HTMLTextAreaElement).maxLength)
      .toBe(PRE_VISIT_NOTE_MAX);
  });
});

describe("DB", () => {
  const SQL = readFileSync("supabase/migrations/20261027010000_pre_visit_note.sql", "utf8").replace(/--[^\n]*/g, "");

  it("NULL 可・既定なし（NULL＝出さない）。長さの上限は画面と同じ", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS pre_visit_note text;/);
    expect(SQL).toContain(`CHECK (pre_visit_note IS NULL OR char_length(pre_visit_note) <= ${PRE_VISIT_NOTE_MAX})`);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.tenants/i);
  });

  it("🔴 体験予約ページへ届ける: get_tenant_public が返す。DROP したら GRANT を貼り直す", () => {
    const i = SQL.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_public");
    const fn = SQL.slice(i, SQL.indexOf("$function$;", i));
    expect(fn).toContain("arrival_lead_minutes integer, pre_visit_note text");
    expect(fn).toContain("t.pre_visit_note");
    expect(SQL.indexOf("DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);")).toBeLessThan(i);
    expect(SQL.slice(i)).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_public\(uuid\) TO anon, authenticated, service_role;/);
  });
});

describe("店の設定の読み込み（tenantColumns）", () => {
  it("取得する列に入っている。列が読めない環境の既定は「出さない」（null）", () => {
    expect(tenantOptionalColumnNames()).toContain("pre_visit_note");
    expect(TENANT_VALUE_DEFAULTS.pre_visit_note).toBeNull();
    expect(normalizeTenantRow({ id: "t1" }).pre_visit_note).toBeNull();
  });
});

describe("文言（5言語）", () => {
  const KEYS = [
    "preVisitLabel", "preVisitDesc", "preVisitPlaceholder", "preVisitTemplate", "preVisitUseTemplate",
    "preVisitPreview", "preVisitSaved", "preVisitSaveFailed",
  ];
  it("見出しと設定の文言が5言語そろっている。例文は上限に収まる", () => {
    for (const l of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const j = JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8"));
      expect(j.booking.preVisitTitle, `${l} preVisitTitle`).toBeTruthy();
      for (const k of KEYS) expect(j.settings.trainer[k], `${l} ${k}`).toBeTruthy();
      expect(j.settings.trainer.preVisitTemplate.length, l).toBeLessThanOrEqual(PRE_VISIT_NOTE_MAX);
    }
  });
});
