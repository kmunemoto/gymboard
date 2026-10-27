/**
 * お知らせの配信対象「全員から除く」「個別（複数）」（2026-10-27）。
 *
 * 宗本さん「この文章の対象を1人だけ除いて送れる様にとかもできるようにして、
 * その辺考えて実装して」。
 *
 * 🔴 壊しやすいもの:
 *   1. 出し分けを画面でやる → 古いアプリのお客様には効かない（DB の読み取り権限でやる）
 *   2. お知らせの行と「選んだ人」を別々に書く → 間に配信が挟まって、除いた人にも届く
 *   3. 配信（push-announcements）が選んだ人を読めなかったとき、全員に送ってしまう
 *   4. 「除く」で選んだ人が、切り替えた「個別」の送り先に化ける
 *   5. 古い1人向け（target=<user_id>）が読めなくなる
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import {
  audienceErrorKey,
  audienceLabel,
  audienceModeOf,
  audienceSaveArgs,
  audienceUserIdsOf,
} from "@/lib/announcementAudience";

// ── 偽の DB ───────────────────────────────────────────────────────────────
type Row = {
  id: string; title: string; body: string; icon: string; target: string;
  published_at: string; created_at: string; announcement_audience?: { user_id: string }[];
};
const db = { rows: [] as Row[], selects: [] as string[] };
const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: "new-id", error: null }));
const invoke = vi.fn(async () => ({ data: null, error: null }));

const builder = (table: string) => {
  const b = {
    select: (cols: string) => { db.selects.push(`${table}:${cols}`); return b; },
    order: () => b,
    in: () => b,
    eq: () => b,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "announcements" ? db.rows : [], error: null }).then(resolve),
  };
  return b;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff-1" } }) }));
const PROFILES = [
  { user_id: "u-a", display_name: "会員A", name_kana: "かいいんえー" },
  { user_id: "u-b", display_name: "会員B", name_kana: "かいいんびー" },
  { user_id: "u-c", display_name: "会員C", name_kana: "かいいんしー" },
];
vi.mock("@/hooks/useProfile", () => ({ useAllCustomerProfiles: () => ({ profiles: PROFILES, loading: false, refetch: vi.fn() }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));

const PAST = "2026-10-01T10:00:00.000Z";
const row = (r: Partial<Row>): Row => ({
  id: r.id ?? "a-1", title: r.title ?? "空きが出ました", body: r.body ?? "ご予約ください", icon: "Bell",
  target: r.target ?? "all", published_at: PAST, created_at: PAST, announcement_audience: r.announcement_audience ?? [],
});

const renderManager = async () => {
  const { default: TrainerAnnouncementManager } = await import("@/components/trainer/TrainerAnnouncementManager");
  render(<TrainerAnnouncementManager />);
  await waitFor(() => expect(screen.getByText(i18n.t("announcement.title"))).toBeTruthy());
};
const openNew = () => {
  fireEvent.click(screen.getByText(i18n.t("announcement.newBtn")));
  fireEvent.change(screen.getByPlaceholderText(i18n.t("announcement.titlePlaceholder")), { target: { value: "空きが出ました" } });
  fireEvent.change(screen.getByPlaceholderText(i18n.t("announcement.bodyPlaceholder")), { target: { value: "ご予約ください" } });
};
const mode = (key: string) => fireEvent.click(screen.getByRole("button", { name: i18n.t(key) }));
const pick = (name: string) =>
  fireEvent.click(within(screen.getByTestId("announcement-audience-list")).getByRole("checkbox", { name }));
const publish = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.btnPublish") }));

beforeEach(() => {
  db.rows = []; db.selects = [];
  rpc.mockClear(); invoke.mockClear(); toastError.mockClear();
});
afterEach(cleanup);

describe("配信対象の値（src/lib/announcementAudience.ts）", () => {
  it("保存済みの target から画面の選択を決める。古い1人向けは「個別」の1人", () => {
    expect(audienceModeOf("all")).toBe("all");
    expect(audienceModeOf("except")).toBe("except");
    expect(audienceModeOf("only")).toBe("only");
    expect(audienceModeOf("u-a")).toBe("only");
    expect(audienceUserIdsOf("u-a", [])).toEqual(["u-a"]);
    expect(audienceUserIdsOf("except", [{ user_id: "u-b" }])).toEqual(["u-b"]);
    expect(audienceUserIdsOf("all", [{ user_id: "u-b" }])).toEqual([]);
    expect(audienceUserIdsOf("only", null)).toEqual([]);
  });

  it("保存: 全員なら選んだ人は送らない。重複は落とす", () => {
    expect(audienceSaveArgs("all", ["u-a"])).toEqual({ p_target: "all", p_user_ids: [] });
    expect(audienceSaveArgs("except", ["u-a", "u-a", "u-b"])).toEqual({ p_target: "except", p_user_ids: ["u-a", "u-b"] });
  });

  it("除く・個別で誰も選んでいなければ保存しない", () => {
    expect(audienceErrorKey("all", [])).toBeNull();
    expect(audienceErrorKey("except", [])).toBe("announcement.errExcept");
    expect(audienceErrorKey("only", [])).toBe("announcement.errTarget");
    expect(audienceErrorKey("except", ["u-a"])).toBeNull();
  });

  it("一覧の文言: 1人なら名前、複数なら数。名前が分からなければ数だけ", () => {
    const nameOf = (id: string) => PROFILES.find((p) => p.user_id === id)?.display_name;
    expect(audienceLabel("all", [], nameOf)).toEqual({ key: "announcement.targetAll" });
    expect(audienceLabel("except", ["u-a"], nameOf)).toEqual({ key: "announcement.labelExceptOne", values: { name: "会員A" } });
    expect(audienceLabel("except", ["u-a", "u-b"], nameOf)).toEqual({ key: "announcement.labelExceptMany", values: { count: 2 } });
    expect(audienceLabel("except", ["gone"], nameOf)).toEqual({ key: "announcement.labelExceptMany", values: { count: 1 } });
    expect(audienceLabel("u-a", ["u-a"], nameOf)).toEqual({ key: "announcement.labelOnlyOne", values: { name: "会員A" } });
    expect(audienceLabel("only", ["u-b", "u-c"], nameOf)).toEqual({ key: "announcement.labelOnlyMany", values: { name: "会員B", rest: 1 } });
    expect(audienceLabel("only", ["gone"], nameOf)).toEqual({ key: "announcement.labelOnlyCount", values: { count: 1 } });
  });
});

describe("お知らせ管理の画面", () => {
  it("🔴「全員から除く」で1人選んで配信 → save_announcement に except とその人を渡し、そのあと配信を起こす", async () => {
    await renderManager();
    openNew();
    mode("announcement.targetExcept");
    expect(screen.getByText(i18n.t("announcement.exceptHint"))).toBeTruthy();
    pick("会員A");
    expect(screen.getByText(i18n.t("announcement.audienceCount", { count: 1 }))).toBeTruthy();
    publish();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("save_announcement");
    expect(args).toMatchObject({ p_title: "空きが出ました", p_body: "ご予約ください", p_target: "except", p_user_ids: ["u-a"] });
    expect(args).not.toHaveProperty("p_id");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("push-announcements", { body: {} }));
  });

  it("除く人を選ばずに配信しようとすると止める", async () => {
    await renderManager();
    openNew();
    mode("announcement.targetExcept");
    publish();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t("announcement.errExcept")));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("個別は複数選べる", async () => {
    await renderManager();
    openNew();
    mode("announcement.targetIndividual");
    pick("会員A");
    pick("会員C");
    publish();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_target: "only", p_user_ids: ["u-a", "u-c"] });
  });

  it("全員なら選んだ人は渡さない（今まで通り）", async () => {
    await renderManager();
    openNew();
    publish();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_target: "all", p_user_ids: [] });
  });

  it("🔴 切り替えたら選び直し（「除く」で選んだ人が「個別」の送り先に化けない）", async () => {
    await renderManager();
    openNew();
    mode("announcement.targetExcept");
    pick("会員A");
    mode("announcement.targetIndividual");
    expect(screen.getByText(i18n.t("announcement.audienceCount", { count: 0 }))).toBeTruthy();
    publish();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t("announcement.errTarget")));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("名前で絞れる。選んだ人は上に並び、×で外せる", async () => {
    await renderManager();
    openNew();
    mode("announcement.targetExcept");
    fireEvent.change(screen.getByLabelText(i18n.t("announcement.audienceSearch")), { target: { value: "B" } });
    const list = screen.getByTestId("announcement-audience-list");
    expect(within(list).queryByText("会員A")).toBeNull();
    pick("会員B");
    expect(within(screen.getByTestId("announcement-audience-selected")).getByText("会員B")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.audienceRemove", { name: "会員B" }) }));
    expect(screen.queryByTestId("announcement-audience-selected")).toBeNull();
  });

  it("編集: 除く人が入った状態で開き、更新ではそのお知らせの id を渡す", async () => {
    db.rows = [row({ id: "a-9", target: "except", announcement_audience: [{ user_id: "u-b" }] })];
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.editAria") }));
    expect(screen.getByRole("button", { name: i18n.t("announcement.targetExcept") }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByTestId("announcement-audience-selected")).getByText("会員B")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.btnUpdate") }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: "a-9", p_target: "except", p_user_ids: ["u-b"] });
  });

  it("🔴 古い1人向け（target=<user_id>）は「個別」のその1人として開ける", async () => {
    db.rows = [row({ id: "a-old", target: "u-a" })];
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.editAria") }));
    expect(screen.getByRole("button", { name: i18n.t("announcement.targetIndividual") }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByTestId("announcement-audience-selected")).getByText("会員A")).toBeTruthy();
  });

  it("一覧に配信対象を出す（全員／除く／個別）", async () => {
    db.rows = [
      row({ id: "a-1", target: "all" }),
      row({ id: "a-2", target: "except", announcement_audience: [{ user_id: "u-a" }] }),
      row({ id: "a-3", target: "except", announcement_audience: [{ user_id: "u-a" }, { user_id: "u-b" }] }),
      row({ id: "a-4", target: "only", announcement_audience: [{ user_id: "u-b" }, { user_id: "u-c" }] }),
      row({ id: "a-5", target: "u-c" }),
    ];
    await renderManager();
    const text = document.body.textContent ?? "";
    expect(text).toContain(i18n.t("announcement.labelExceptOne", { name: "会員A" }));
    expect(text).toContain(i18n.t("announcement.labelExceptMany", { count: 2 }));
    expect(text).toContain(i18n.t("announcement.labelOnlyMany", { name: "会員B", rest: 1 }));
    expect(text).toContain("会員C");
  });

  it("選んだ人はお知らせと一緒に読む（店のスタッフだけが読める表）", async () => {
    await renderManager();
    expect(db.selects).toContain("announcements:*, announcement_audience(user_id)");
  });
});

describe("お客様の画面", () => {
  it("🔴 お知らせは表を直接読み、配信対象で絞らない（出し分けは DB の読み取り権限。古いアプリにも効く）", () => {
    const code = readFileSync("src/hooks/useAnnouncements.ts", "utf8");
    expect(code).not.toMatch(/\.eq\("target"|\.or\(|announcement_audience/);
  });
});

describe("DB", () => {
  const SQL = readFileSync("supabase/migrations/20261027020000_announcement_audience.sql", "utf8").replace(/--[^\n]*/g, "");
  const fnBody = (name: string) => {
    const i = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    return SQL.slice(i, SQL.indexOf("$fn$;", i));
  };

  it("選んだ人の表: 店のスタッフだけが読み書き。ジムの境界は RESTRICTIVE。未ログインは触れない", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.announcement_audience/);
    expect(SQL).toMatch(/REFERENCES public\.announcements\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/PRIMARY KEY \(announcement_id, user_id\)/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.announcement_audience FROM anon;/);
    expect(SQL).toMatch(/CREATE POLICY tenant_isolation ON public\.announcement_audience AS RESTRICTIVE/);
    for (const p of ["announcement_audience_select", "announcement_audience_insert", "announcement_audience_delete"]) {
      const i = SQL.indexOf(`CREATE POLICY ${p}`);
      expect(i, p).toBeGreaterThan(-1);
      expect(SQL.slice(i, SQL.indexOf(";", i)), p).toContain("has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])");
    }
    // 入れるのは、同じジムのお知らせに、そのジムの在籍者だけ
    const ins = SQL.slice(SQL.indexOf("CREATE POLICY announcement_audience_insert"));
    expect(ins.slice(0, ins.indexOf(";"))).toContain("is_tenant_member(tenant_id, user_id)");
  });

  it("「選ばれているか」は SECURITY DEFINER（お客様は表を読めない）。実行はログイン済みだけ", () => {
    expect(fnBody("announcement_audience_has")).toContain("STABLE SECURITY DEFINER");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.announcement_audience_has\(uuid, uuid\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.announcement_audience_has\(uuid, uuid\) TO authenticated;/);
  });

  it("🔴 読み取り権限: 今までの3つ（トレーナー・全員・1人向け）を残し、除く／個別を足す", () => {
    const i = SQL.indexOf(`CREATE POLICY "Users view own/all announcements"`);
    const policy = SQL.slice(i, SQL.indexOf(";", i));
    expect(policy).toContain("has_role(auth.uid(), 'trainer'::app_role)");
    expect(policy).toContain("published_at <= now()");
    expect(policy).toContain("target = 'all'");
    expect(policy).toContain("target = (auth.uid())::text");
    expect(policy).toContain("(target = 'except' AND NOT public.announcement_audience_has(id, auth.uid()))");
    expect(policy).toContain("(target = 'only' AND public.announcement_audience_has(id, auth.uid()))");
  });

  it("🔴 保存は1つの関数で行と選んだ人を書く。呼んだ人の権限のまま（SECURITY INVOKER）", () => {
    const fn = fnBody("save_announcement");
    expect(fn).toContain("SECURITY INVOKER");
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("p_target NOT IN ('all', 'except', 'only')");
    expect(fn).toContain("audience_required");
    expect(fn).toContain("public.get_my_tenant_id()");
    expect(fn).toMatch(/INSERT INTO public\.announcements[\s\S]*INSERT INTO public\.announcement_audience/);
    // 更新は差分だけ（全消し→全入れはしない）
    expect(fn).toContain("NOT (user_id = ANY (v_ids))");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.save_announcement\([^)]*\) FROM PUBLIC, anon;/);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("閉店（delete_my_gym）で選んだ人も消す。お知らせより先に", () => {
    const dmg = readFileSync("supabase/migrations/20261027020100_delete_gym_announcement_audience.sql", "utf8");
    const iAud = dmg.indexOf("DELETE FROM public.announcement_audience");
    expect(iAud).toBeGreaterThan(-1);
    expect(iAud).toBeLessThan(dmg.indexOf("DELETE FROM public.announcements "));
  });
});

describe("プッシュ通知（push-announcements）", () => {
  const fn = readFileSync("supabase/functions/push-announcements/index.ts", "utf8");

  it("除く／個別は選んだ人を読む。除くは在籍のお客様全員から引く", () => {
    expect(fn).toContain('.from("announcement_audience")');
    expect(fn).toMatch(/a\.target === "except" \? audience : \[\]/);
    expect(fn).toMatch(/if \(a\.target === "only"\) \{\s*userIds = audience;/);
  });

  it("🔴 選んだ人が読めなかったら送らない（クレームを外して次の実行でやり直す）", () => {
    const i = fn.indexOf("if (audErr)");
    const block = fn.slice(i, fn.indexOf("continue;", i));
    expect(block).toContain("push_sent_at: null");
    expect(block).not.toContain("send-push-notification");
  });

  it("古い1人向け（target=<user_id>）はその1人に送る", () => {
    expect(fn).toMatch(/a\.target !== "all" && a\.target !== "except"\) \{\s*userIds = \[a\.target\];/);
  });
});

describe("文言（5言語）", () => {
  const KEYS = [
    "targetExcept", "exceptHint", "onlyHint", "audienceSearch", "audienceCount", "audienceEmpty", "audienceRemove",
    "customerNoName", "errExcept", "labelExceptOne", "labelExceptMany", "labelOnlyOne", "labelOnlyMany", "labelOnlyCount",
  ];
  it("配信対象の文言が5言語そろっている", () => {
    for (const l of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const j = JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8"));
      for (const k of KEYS) expect(j.announcement[k], `${l} ${k}`).toBeTruthy();
    }
  });
});
