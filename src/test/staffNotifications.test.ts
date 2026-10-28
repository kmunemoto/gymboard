/**
 * 通知の宛先: オーナーは全部、先生（インストラクター）は自分が担当の予約だけ（2026-10-28）。
 *
 * 宗本さん:
 *   「オーナーは全てを把握してるように」
 *   「先生には、先生が担当している予約だけ通知が届く様にして」
 *   「オーナーは全ての通知を受け取る」
 *   「先生に関する通知は先生に届くように」
 *
 * 🔴 壊しやすいもの:
 *   1. 代表（店宛てのメール・LINE・お客様のチャットの宛先）がオーナーから外れる
 *      （trainer 優先に戻す・インストラクターを代表に入れる）
 *   2. 先生に、担当していない予約の通知が届く（店宛ての全員に先生を入れる）
 *   3. 先生の担当の予約を、店が入れた・付け替えた・オプションを変えたときに先生に届かない
 *   4. オーナー以外（先生・スタッフ）が動かした予約を、オーナーが知らない
 *   5. 操作した本人に、自分の操作の通知が届く
 *
 * 宛先の規則は src/lib/staffAccess.ts（notifiableStaffOrder・staffChangeRecipients）、
 * 送るのは src/lib/staffNotify.ts と Edge Function（notify-new-booking・daily-trainer-summary ほか）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { notifiableStaffOrder, staffChangeRecipients } from "@/lib/staffAccess";
import { fetchMyTenantStaffRoster, fetchMyTenantTrainerId } from "@/lib/tenantHelper";
import { notifyStaffOptionChanged, notifyStaffReassigned } from "@/lib/staffNotify";

// ── モック ─────────────────────────────────────────────────────────────
const db = {
  /** ログイン中の人（操作した人） */
  session: "owner" as string | null,
  /** tenant_members の SELECT が返す行（並びは DB の joined_at 昇順のつもりで書く） */
  members: [] as Record<string, unknown>[],
  noStaffAccessColumn: false,
  selects: [] as string[],
  invokes: [] as { fn: string; body: Record<string, unknown> }[],
  invokeFails: false,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: db.session ? { user: { id: db.session } } : null } }),
    },
    from: () => {
      let cols = "";
      const result = () => {
        db.selects.push(cols);
        if (cols === "tenant_id") return { data: { tenant_id: "t1" }, error: null };
        if (db.noStaffAccessColumn && cols.includes("staff_access")) {
          return { data: null, error: { code: "42703", message: "column tenant_members.staff_access does not exist" } };
        }
        return { data: db.members, error: null };
      };
      const q: Record<string, unknown> = {
        select: (c: string) => { cols = c; return q; },
        eq: () => q,
        in: () => q,
        order: () => q,
        maybeSingle: () => Promise.resolve(result()),
        then: (ok: (r: unknown) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ng),
      };
      return q;
    },
    functions: {
      invoke: (fn: string, opts: { body: Record<string, unknown> }) => {
        db.invokes.push({ fn, body: opts.body });
        return db.invokeFails ? Promise.reject(new Error("network")) : Promise.resolve({ data: null, error: null });
      },
    },
  },
}));

/** 宗本さんのジムの形: オーナー＋先生（ヨガとマシンピラティスの両方の担当） */
const SALUTE_LIKE = [
  { user_id: "owner", role: "owner", joined_at: "2025-01-01", display_name: "Owner", staff_access: "full" },
  { user_id: "inst", role: "trainer", joined_at: "2026-10-28", display_name: " Hanako ", staff_access: "limited" },
];
/** スタッフもいる店 */
const WITH_STAFF = [
  { user_id: "staff", role: "trainer", joined_at: "2026-01-01", display_name: "Taro", staff_access: "full" },
  ...SALUTE_LIKE,
];

beforeEach(() => {
  db.session = "owner";
  db.members = SALUTE_LIKE;
  db.noStaffAccessColumn = false;
  db.selects = [];
  db.invokes = [];
  db.invokeFails = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const read = (path: string) => readFileSync(path, "utf8");

// ── 宛先の規則（src/lib/staffAccess.ts）──────────────────────────────────
describe("代表の並び（notifiableStaffOrder）", () => {
  it("🔴 代表（先頭）はオーナー。スタッフはその後ろ（参加順のまま）。インストラクターは入れない", () => {
    const rows = [
      { user_id: "staff-a", role: "trainer", staff_access: "full" },
      { user_id: "inst", role: "trainer", staff_access: "limited" },
      { user_id: "owner", role: "owner", staff_access: "full" },
      { user_id: "staff-b", role: "trainer" }, // 列の無い環境の行＝今まで通りのスタッフ
    ];
    expect(notifiableStaffOrder(rows)).toEqual(["owner", "staff-a", "staff-b"]);
  });

  it("同じ人の行が2つあっても1回。オーナーが読めなければスタッフが先頭（今まで通り代表はいる）", () => {
    expect(notifiableStaffOrder([
      { user_id: "owner", role: "owner" }, { user_id: "owner", role: "owner" },
    ])).toEqual(["owner"]);
    expect(notifiableStaffOrder([{ user_id: "staff", role: "trainer" }])).toEqual(["staff"]);
    expect(notifiableStaffOrder([])).toEqual([]);
  });
});

describe("店側の操作を知らせる相手（staffChangeRecipients）", () => {
  const roster = { owners: ["owner"] };

  it("宗本さんのジム: オーナーが先生の予約を動かしたら先生だけ。担当のいない予約なら誰にも送らない（今まで通り）", () => {
    expect(staffChangeRecipients(roster, "owner", ["inst"])).toEqual(["inst"]);
    expect(staffChangeRecipients(roster, "owner", [null])).toEqual([]);
    expect(staffChangeRecipients(roster, "owner", ["owner"])).toEqual([]);
  });

  it("🔴 先生が動かしたらオーナーに届く（自分の担当の予約でも、担当のいない予約でも）。先生本人には送らない", () => {
    expect(staffChangeRecipients(roster, "inst", ["inst"])).toEqual(["owner"]);
    expect(staffChangeRecipients(roster, "inst", [null])).toEqual(["owner"]);
  });

  it("担当の付け替えは前と後の両方。操作した本人は除く", () => {
    // オーナーが先生 → 指名なし
    expect(staffChangeRecipients(roster, "owner", ["inst", null])).toEqual(["inst"]);
    // オーナーが自分 → 先生
    expect(staffChangeRecipients(roster, "owner", ["owner", "inst"])).toEqual(["inst"]);
    // 先生が自分 → オーナー
    expect(staffChangeRecipients(roster, "inst", ["inst", "owner"])).toEqual(["owner"]);
  });

  it("🔴 スタッフ（オーナー以外）が動かしてもオーナーに届く（先生をあとで「スタッフ」に切り替えても変わらない）", () => {
    expect(staffChangeRecipients(roster, "staff", ["inst"])).toEqual(["inst", "owner"]);
    expect(staffChangeRecipients(roster, "staff", [null])).toEqual(["owner"]);
    // オーナーがスタッフの予約を先生に付け替えたら、スタッフと先生に
    expect(staffChangeRecipients(roster, "owner", ["staff", "inst"])).toEqual(["staff", "inst"]);
  });

  it("操作した人が分からない（ログインが読めない）ときはオーナーに倒す（知らせ漏れより、余分な1通のほうが害が小さい）", () => {
    expect(staffChangeRecipients(roster, null, ["inst"])).toEqual(["inst", "owner"]);
  });
});

// ── 店のスタッフの並び（src/lib/tenantHelper.ts）────────────────────────────
describe("店のスタッフの並び（fetchMyTenantStaffRoster）", () => {
  it("代表の並び（オーナー先頭・インストラクター抜き）・オーナー・表示名を返す", async () => {
    db.members = WITH_STAFF;
    const roster = await fetchMyTenantStaffRoster();
    expect(roster.ids).toEqual(["owner", "staff"]);
    expect(roster.owners).toEqual(["owner"]);
    expect(roster.names).toEqual({ owner: "Owner", staff: "Taro", inst: "Hanako" });
    expect(db.selects).toContain("user_id, role, joined_at, display_name, staff_access");
  });

  it("🔴 代表（fetchMyTenantTrainerId）はオーナー。先に参加したスタッフ・先生がいても変わらない", async () => {
    db.members = WITH_STAFF;
    expect(await fetchMyTenantTrainerId()).toBe("owner");
  });

  it("権限の列が無い環境では列を外して読み直す（全員を今まで通りのスタッフとして扱う）", async () => {
    db.noStaffAccessColumn = true;
    db.members = WITH_STAFF.map(({ staff_access: _drop, ...r }) => r);
    const roster = await fetchMyTenantStaffRoster();
    expect(roster.ids).toEqual(["owner", "staff", "inst"]);
    expect(roster.owners).toEqual(["owner"]);
    expect(db.selects).toContain("user_id, role, joined_at, display_name");
  });

  it("所属が無ければ空（通知は送らない）", async () => {
    db.session = null;
    expect(await fetchMyTenantStaffRoster()).toEqual({ ids: [], owners: [], names: {} });
  });
});

// ── 送る（src/lib/staffNotify.ts）───────────────────────────────────────
describe("担当の付け替えの通知（notifyStaffReassigned）", () => {
  const base = { bookingId: "b1", clientName: "Client", date: "2026-11-02", startTime: "10:00" };

  it("オーナーが先生の予約を「指名なし」にしたら、先生に届く（名前つき）", async () => {
    await notifyStaffReassigned({ ...base, fromStaffId: "inst", toStaffId: null });
    expect(db.invokes).toEqual([{
      fn: "send-push-notification",
      body: {
        user_ids: ["inst"],
        title: "予約の担当の変更",
        body: "Client様 11月2日 10:00 の予約の担当: Hanako → 指名なし",
        url: "/",
        tag: "staff-reassign-b1",
      },
    }]);
  });

  it("先生が付け替えたらオーナーに届く。先生本人には送らない", async () => {
    db.session = "inst";
    await notifyStaffReassigned({ ...base, fromStaffId: "inst", toStaffId: "owner" });
    expect(db.invokes).toHaveLength(1);
    expect(db.invokes[0].body.user_ids).toEqual(["owner"]);
    expect(db.invokes[0].body.body).toBe("Client様 11月2日 10:00 の予約の担当: Hanako → Owner");
  });

  it("変わっていない・知らせる相手がいない（オーナーが自分に付けた）ときは送らない", async () => {
    await notifyStaffReassigned({ ...base, fromStaffId: "inst", toStaffId: "inst" });
    await notifyStaffReassigned({ ...base, fromStaffId: null, toStaffId: "owner" });
    expect(db.invokes).toEqual([]);
  });

  it("送れなくても例外を投げない（付け替えそのものは成立させる）", async () => {
    db.invokeFails = true;
    await expect(notifyStaffReassigned({ ...base, fromStaffId: "inst", toStaffId: null })).resolves.toBeUndefined();
    expect(db.invokes).toHaveLength(1);
  });
});

describe("オプションの変更の通知（notifyStaffOptionChanged）", () => {
  const base = {
    bookingId: "b2", clientName: "Client", bookingDate: "2026-11-02T01:00:00Z", bookingTime: "10:00〜11:30",
  };

  it("オーナーが先生の予約のオプションを変えたら、先生に届く", async () => {
    await notifyStaffOptionChanged({ ...base, assignedStaffId: "inst", summary: "Stretch +30" });
    expect(db.invokes).toEqual([{
      fn: "send-push-notification",
      body: {
        user_ids: ["inst"],
        title: "予約のオプションの変更",
        body: "Client様 11月2日 10:00〜11:30 ／ Stretch +30",
        url: "/",
        tag: "staff-option-b2",
      },
    }]);
  });

  it("外したときはそう書く。先生が変えたらオーナーに届く", async () => {
    db.session = "inst";
    await notifyStaffOptionChanged({ ...base, assignedStaffId: "inst", summary: "" });
    expect(db.invokes[0].body.user_ids).toEqual(["owner"]);
    expect(db.invokes[0].body.body).toBe("Client様 11月2日 10:00〜11:30（オプションなし）");
  });

  it("オーナーが担当のいない予約を変えたときは送らない（今まで通り）", async () => {
    await notifyStaffOptionChanged({ ...base, assignedStaffId: null, summary: "Stretch +30" });
    expect(db.invokes).toEqual([]);
  });
});

// ── つなぎ込み（ソース）────────────────────────────────────────────────
describe("画面・フックのつなぎ込み（ソース）", () => {
  it("予定表: 担当を付け替えたら、成功したあとに知らせる（失敗したら送らない）", () => {
    const src = read("src/components/trainer/TrainerSchedule.tsx");
    const success = src.indexOf('toast.success(t("staff.assignedToast"));');
    const call = src.indexOf("void notifyStaffReassigned({");
    expect(success).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(success);
    expect(src.slice(call, call + 300)).toContain("fromStaffId: assignTarget.staffUserId, toStaffId: nextStaffId || null");
  });

  it("オプションの変更: 中身が変わったときだけ、その予約の担当に知らせる", () => {
    const src = read("src/hooks/bookingOptionEdit.ts");
    expect(src).toContain("if (changed) await notifyCustomer(row, minutes, bookingOptions);");
    expect(src).toContain("assignedStaffId: (row.staff_user_id as string | null) ?? null, summary: removed ? \"\" : summary,");
  });

  it("キャンセルのメール: 代表（オーナー）と、予約の担当（先生）に1通ずつ。代表の冪等キーは今まで通り", () => {
    const src = read("src/hooks/useBookings.ts");
    expect(src).toContain("for (const to of withAssignedStaff(trainerId ? [trainerId] : [], booking.staff_user_id)) {");
    expect(src).toContain("idempotencyKey: to === trainerId ? `cancel-trainer-${booking.id}` : `cancel-trainer-${booking.id}-${to}`,");
    expect(src).toContain("trainerUserId: to,");
  });

  it("キャンセルのプッシュ: 店が取り消したときは「店が」と書く（先生がお客様の取り消しと区別できる）", () => {
    const src = read("src/hooks/useBookings.ts");
    expect(src).toMatch(/body: cancelledByTrainer\s*\? `\$\{customerName\}さんの \$\{md\} \$\{hm\} の予約を店がキャンセルしました\$\{forfeitSuffix\}`/);
  });
});

describe("Edge Function（ソース）", () => {
  const NOTIFY = read("supabase/functions/notify-new-booking/index.ts");
  const SUMMARY = read("supabase/functions/daily-trainer-summary/index.ts");

  it("新しい予約: 担当（先生）にもメール。代表と同じ人・自分で入れた代理予約には送らない", () => {
    expect(NOTIFY).toContain("if (assignedStaff && assignedStaff !== trainerId && assignedStaff !== actorUserId) {");
    expect(NOTIFY).toContain("idempotencyKey: `booking-notify-${booking.id}-staff`,");
    expect(NOTIFY).toContain("trainerUserId: assignedStaff,");
  });

  it("🔴 代理予約のプッシュ: 担当と、オーナー以外が入れたならオーナー（staffChangeRecipients と同じ規則）", () => {
    expect(NOTIFY).toContain('const ownerIds = staffRows.filter((m) => m.role === "owner").map((m) => m.user_id);');
    expect(NOTIFY).toContain("const actorIsOwner = ownerIds.includes(actorUserId);");
    expect(NOTIFY).toContain("[...new Set([...(assignedStaff ? [assignedStaff] : []), ...(actorIsOwner ? [] : ownerIds)])]");
    expect(NOTIFY).toContain(".filter((id) => id !== actorUserId);");
    // 操作した人が分からない（記録が無い）代理予約は今まで通り鳴らさない
    expect(NOTIFY).toMatch(/\} else if \(actorUserId\) \{/);
    expect(NOTIFY).toContain('let pushResult = "skipped:proxy";');
  });

  it("朝の本日の予定: 先生には自分が担当の予約だけ（店の分とは別のキーで1日1回）", () => {
    expect(SUMMARY).toContain('.eq("staff_access", "limited");');
    expect(SUMMARY).toContain("const mine = items.filter((i) => i.staff === inst);");
    expect(SUMMARY).toContain("if (mine.length === 0) continue;");
    expect(SUMMARY).toContain("const instKey = `daily-summary-${t.id}-${inst}-${dateKey}`;");
    expect(SUMMARY).toContain("body: { user_ids: [inst], title: `本日の担当（${mine.length}件）`, body: lines.join(\"\\n\"), url: \"/\", tag: instKey },");
    // 店の分（オーナー・スタッフ）にはインストラクターを入れない
    expect(SUMMARY).toContain('.neq("staff_access", "limited");');
    // 体験は担当を持たない（先生の分に混ざらない）
    expect(SUMMARY).toContain("staff: null })),");
  });

  it("朝の本日の予定: メニューが2つ以上ある店だけ、行にメニュー名を添える（menuNameOf と同じ規則）", () => {
    expect(SUMMARY).toContain("(menuRows ?? []).length >= 2 ?");
    expect(SUMMARY).toContain("label: withMenu(nameMap[b.user_id] || \"顧客\", (b.menu_id as string | null) ?? null),");
  });

  it("🔴 体験・ドロップイン・体験のキャンセルの代表もオーナー（trainer 優先に戻さない）", () => {
    for (const fn of ["trial-book", "drop-in-book", "trial-cancel"]) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src, fn).toMatch(/staffRows\.find\(\(m(?:: any)?\) => m\.role === "owner"\) \?\? staffRows\[0\]/);
      expect(src, fn).not.toMatch(/staffRows\.find\(\(m(?:: any)?\) => m\.role === "trainer"\)/);
      expect(src, fn).toContain('.neq("staff_access", "limited")');
    }
  });
});

// ── 出回っている古いアプリとの共存（サーバー側で直す）──────────────────────────
// 古いアプリは代表を「スタッフ優先」で選ぶ（2026-10-28 より前の src/lib/tenantHelper.ts）。
// 先生（インストラクター）が参加すると、古いアプリのお客様のチャットと店宛てのメールが先生に行く。
// アプリは書き換えられないので、受け取るサーバー側でオーナーに戻す。
describe("古いアプリとの共存（Edge Function・ソース）", () => {
  const MESSAGE = read("supabase/functions/notify-new-message/index.ts");
  const EMAIL = read("supabase/functions/send-transactional-email/index.ts");

  it("🔴 チャット: お客様から先生（インストラクター）宛てのメッセージは、代表（オーナー）に知らせる", () => {
    expect(MESSAGE).toContain('.select("id, sender_id, receiver_id, content, attachment_type, created_at, tenant_id")');
    expect(MESSAGE).toContain(
      'if (!(receiver?.role === "trainer" && receiver.staff_access === "limited" && sender?.role === "customer")) {',
    );
    expect(MESSAGE).toContain('.neq("staff_access", "limited")');
    expect(MESSAGE).toContain('(staffRows.find((m) => m.role === "owner") ?? staffRows[0])?.user_id ?? message.receiver_id');
    expect(MESSAGE).toContain("user_ids: [pushTo],");
    expect(MESSAGE).toContain("tag: `chat-${message.sender_id}-${pushTo}`,");
    expect(MESSAGE).not.toContain("user_ids: [message.receiver_id]");
  });

  it("🔴 店宛てのメール: 代表のキー（末尾が予約 id）だけが対象。担当宛ての写し・ほかの通知は対象外", () => {
    const m = EMAIL.match(/const REPRESENTATIVE_KEY = \/(.+)\/\n/);
    expect(m, "REPRESENTATIVE_KEY が見つからない").toBeTruthy();
    const re = new RegExp(m![1]);
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(re.test(`cancel-trainer-${id}`)).toBe(true);
    expect(re.test(`booking-notify-${id}`)).toBe(true);
    // 今のアプリ・サーバーが担当（先生）に送る写し
    expect(re.test(`cancel-trainer-${id}-${id}`)).toBe(false);
    expect(re.test(`booking-notify-${id}-staff`)).toBe(false);
    for (const k of [`cancel-customer-${id}`, `booking-confirm-customer-${id}`, `option-change-${id}-30-`, `trial-confirm-${id}`]) {
      expect(re.test(k), k).toBe(false);
    }
  });

  it("送り直しは宛先の解決の直前。宛先がインストラクターのときだけ代表（オーナー優先・インストラクター除く）に", () => {
    const fix = EMAIL.indexOf("REPRESENTATIVE_KEY.test(explicitIdempotencyKey ?? '')");
    const resolve = EMAIL.indexOf("// Special: resolve trainer email from DB when placeholder is used");
    expect(fix).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(fix);
    expect(EMAIL).toContain("if (!(row?.role === 'trainer' && row.staff_access === 'limited')) return null");
    expect(EMAIL).toContain(".neq('staff_access', 'limited')");
    expect(EMAIL).toContain("return (rows.find((m) => m.role === 'owner') ?? rows[0])?.user_id ?? null");
    expect(EMAIL).toContain("if (rep) templateData = { ...templateData, trainerUserId: rep }");
  });

  it("今のアプリは代表のキーを先生に使わない（代表はオーナー・先生には別のキー）", () => {
    // ここが崩れると、今のアプリの「先生への写し」までオーナーに送り直されてしまう
    expect(read("src/hooks/useBookings.ts")).toContain(
      "idempotencyKey: to === trainerId ? `cancel-trainer-${booking.id}` : `cancel-trainer-${booking.id}-${to}`,",
    );
    expect(read("supabase/functions/notify-new-booking/index.ts")).toContain("idempotencyKey: `booking-notify-${booking.id}-staff`,");
  });
});
