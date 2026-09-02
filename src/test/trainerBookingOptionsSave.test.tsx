import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";

// 予約オプションの「保存」を、偽の DB を相手に実際に動かして見張る。
//
// ── なぜ本文検査ではなくここまでやるか（2026-09-03）────────────────────
// #367 で保存を「更新 → 追加 → 削除」の順に書いた。順番の見張り
// （bookingOptions.test.ts）は通っていたのに、**最初の1件を追加すると
// 保存した直後に消える**という不具合を出荷した。
//
//   - 追加した行は id が null。insert では採番された id を受け取っていなかった
//   - 最後の削除は「残す id の一覧」以外を消す。新しい id が入っていないので
//     一覧が空になり、条件なしの全削除に落ちて、いま入れた行ごと消えていた
//   - toast は画面の状態だけ見て「保存しました」と出るので、成功に見える
//
// 順番だけを見る検査では、この「削除の条件が間違っている」を1つも捕まえられない。
// ここでは行が生き残るかどうかを見る。

type Row = {
  id: string;
  tenant_id: string;
  name: string;
  duration_minutes: number;
  price_yen: number;
  enabled: boolean;
  sort_order: number;
  created_at: number;
};

const TENANT = "t-1";
// insertReturnsIds=false は「insert が採番結果を返さない」異常時の再現用。
const db = { rows: [] as Row[], seq: 0, clock: 0, insertReturnsIds: true };

/** PostgREST の使っている範囲だけを真似た偽クライアント（await で走る）。 */
const makeBuilder = () => {
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Record<string, unknown>[] = [];
  const eqs: [string, unknown][] = [];
  let notIn: { col: string; values: string[] } | null = null;
  let wantIds = false;

  const matches = (r: Row) =>
    eqs.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v) &&
    (!notIn || !notIn.values.includes(String((r as unknown as Record<string, unknown>)[notIn.col])));

  const run = () => {
    if (op === "select") {
      const data = db.rows
        .filter(matches)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
      return { data, error: null };
    }
    if (op === "insert") {
      const created = payload.map((v) => ({
        ...(v as unknown as Omit<Row, "id" | "created_at">),
        id: `db-${++db.seq}`,
        created_at: ++db.clock,
      })) as Row[];
      db.rows.push(...created);
      const ids = db.insertReturnsIds ? created.map((r) => ({ id: r.id })) : [];
      return { data: wantIds ? ids : null, error: null };
    }
    if (op === "update") {
      db.rows = db.rows.map((r) => (matches(r) ? { ...r, ...(payload[0] as Partial<Row>) } : r));
      return { data: null, error: null };
    }
    db.rows = db.rows.filter((r) => !matches(r));
    return { data: null, error: null };
  };

  const b = {
    select: (_cols: string) => {
      if (op === "insert") wantIds = true;
      return b;
    },
    insert: (v: Record<string, unknown> | Record<string, unknown>[]) => {
      op = "insert";
      payload = Array.isArray(v) ? v : [v];
      return b;
    },
    update: (v: Record<string, unknown>) => {
      op = "update";
      payload = [v];
      return b;
    },
    delete: () => {
      op = "delete";
      return b;
    },
    eq: (c: string, v: unknown) => {
      eqs.push([c, v]);
      return b;
    },
    order: () => b,
    not: (col: string, _operator: string, list: string) => {
      notIn = { col, values: list.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean) };
      return b;
    },
    then: (
      resolve: (v: { data: unknown; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(run()).then(resolve, reject),
  };
  return b;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (_table: string) => makeBuilder() },
}));

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({
    tenant: { id: TENANT, name: "テストジム" },
    membership: null,
    role: "owner",
    plans: [],
    loading: false,
    refetch: vi.fn(),
  }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

const seed = (rows: Partial<Row>[]) => {
  db.rows = rows.map((r, i) => ({
    id: r.id ?? `seed-${i + 1}`,
    tenant_id: TENANT,
    name: r.name ?? `既存${i + 1}`,
    duration_minutes: r.duration_minutes ?? 30,
    price_yen: r.price_yen ?? 3000,
    enabled: r.enabled ?? true,
    sort_order: r.sort_order ?? i,
    created_at: ++db.clock,
  }));
};

const mine = () => db.rows.filter((r) => r.tenant_id === TENANT);
const others = () => db.rows.filter((r) => r.tenant_id !== TENANT);

const seedOtherGym = () => {
  db.rows.push({
    id: "other-1",
    tenant_id: "t-other",
    name: "よそのジム",
    duration_minutes: 30,
    price_yen: 1000,
    enabled: true,
    sort_order: 0,
    created_at: ++db.clock,
  });
};

const renderCard = async () => {
  const { default: TrainerBookingOptions } = await import(
    "@/components/trainer/TrainerBookingOptions"
  );
  render(<TrainerBookingOptions />);
  await waitFor(() =>
    expect(screen.getByText(i18n.t("bookingOptions.section"))).toBeTruthy(),
  );
};

const addRow = (name: string) => {
  fireEvent.click(screen.getByText(i18n.t("bookingOptions.addOption")));
  const inputs = screen.getAllByPlaceholderText(i18n.t("bookingOptions.namePlaceholder"));
  fireEvent.change(inputs[inputs.length - 1], { target: { value: name } });
};

const save = async () => {
  fireEvent.click(screen.getByText(i18n.t("common.save")));
  await waitFor(() => expect(screen.queryByText(i18n.t("common.saving"))).toBeNull());
};

const deleteRowAt = (index: number) => {
  const buttons = screen.getAllByLabelText(i18n.t("common.delete"));
  fireEvent.click(buttons[index]);
};

beforeEach(() => {
  db.rows = [];
  db.seq = 0;
  db.clock = 0;
  db.insertReturnsIds = true;
  toastError.mockClear();
});
afterEach(cleanup);

describe("🔴 予約オプションの保存で行が消えない", () => {
  it("いちばん最初の1件を追加して保存すると、その1件が残る", async () => {
    seed([]);
    await renderCard();
    expect(screen.getByText(i18n.t("bookingOptions.empty"))).toBeTruthy();

    addRow("追加メニューB");
    await save();

    // 🔴 ここが 0 件だと、保存した瞬間に自分で消している（#367 の不具合）
    expect(mine()).toHaveLength(1);
    expect(mine()[0].name).toBe("追加メニューB");
    expect(toastError).not.toHaveBeenCalled();
    // 画面も「まだありません」に戻らない
    await waitFor(() => expect(screen.queryByText(i18n.t("bookingOptions.empty"))).toBeNull());
  });

  it("既存があるところに1件足しても、両方残って既存の id は変わらない", async () => {
    seed([{ id: "keep-1", name: "既存メニュー" }]);
    await renderCard();

    addRow("追加メニュー");
    await save();

    expect(mine()).toHaveLength(2);
    expect(mine().map((r) => r.name).sort()).toEqual(["既存メニュー", "追加メニュー"].sort());
    // id は差し替えず更新する（過去の予約から何を付けたか辿れなくなるため）
    expect(mine().some((r) => r.id === "keep-1")).toBe(true);
  });

  it("🔴 既存を1件消して同時に1件足すと、消えるのは消したほうだけ", async () => {
    // insert が採番された id を返さないと「残す id」が空になり、
    // 消したはずの行が生き残る（または全部消える）。この形でしか捕まらない。
    seed([{ id: "gone-1", name: "やめるメニュー" }]);
    await renderCard();

    deleteRowAt(0);
    addRow("新メニュー");
    await save();

    expect(mine()).toHaveLength(1);
    expect(mine()[0].name).toBe("新メニュー");
    expect(mine().some((r) => r.id === "gone-1")).toBe(false);
  });

  it("画面から全部消して保存したときだけ、全件消える", async () => {
    seed([{ id: "a" }, { id: "b" }]);
    await renderCard();

    deleteRowAt(0);
    deleteRowAt(0);
    await save();

    expect(mine()).toHaveLength(0);
  });

  it("2件のうち1件だけ消したら、残したほうは id ごと残る", async () => {
    seed([{ id: "a", name: "残す" }, { id: "b", name: "消す" }]);
    await renderCard();

    deleteRowAt(1);
    await save();

    expect(mine()).toHaveLength(1);
    expect(mine()[0].id).toBe("a");
  });

  it("他のジムのオプションは巻き添えにならない（全部消したとき）", async () => {
    seed([{ id: "a", name: "自店" }]);
    seedOtherGym();
    await renderCard();

    deleteRowAt(0);
    await save();

    expect(mine()).toHaveLength(0);
    expect(others()).toHaveLength(1);
  });

  it("他のジムのオプションは巻き添えにならない（1件だけ消したとき）", async () => {
    // 絞り込みつきの削除にも tenant_id の条件が要る。無いと「残す id 以外」が
    // 全テナントに及び、よそのジムのオプションまで消える。
    seed([{ id: "a", name: "残す" }, { id: "b", name: "消す" }]);
    seedOtherGym();
    await renderCard();

    deleteRowAt(1);
    await save();

    expect(mine()).toHaveLength(1);
    expect(others()).toHaveLength(1);
  });

  it("既存の行を書き換えたら、その内容が保存される（id は据え置き）", async () => {
    seed([{ id: "keep-1", name: "旧メニュー", price_yen: 3000 }]);
    await renderCard();

    const input = screen.getByPlaceholderText(i18n.t("bookingOptions.namePlaceholder"));
    fireEvent.change(input, { target: { value: "新メニュー" } });
    await save();

    expect(mine()).toHaveLength(1);
    expect(mine()[0].id).toBe("keep-1");
    expect(mine()[0].name).toBe("新メニュー");
  });

  it("🔴 insert が id を返さなかったら、削除は見送る（消せる根拠が無いので）", async () => {
    // ここが「全削除するかどうか」を残す id の件数で決めていると、
    // 既存のオプションが巻き添えで全部消える。件数ではなく
    // 「画面が0件か」で決めていれば、消し損ねで済む（次の保存でやり直せる）。
    seed([{ id: "keep-1", name: "既存メニュー" }]);
    db.insertReturnsIds = false;
    await renderCard();

    deleteRowAt(0);
    addRow("新メニュー");
    await save();

    // 新しい行は入っている。消し損ねた既存も残っている（0件にはならない）
    expect(mine().length).toBeGreaterThan(0);
    expect(mine().some((r) => r.name === "新メニュー")).toBe(true);
  });
});
