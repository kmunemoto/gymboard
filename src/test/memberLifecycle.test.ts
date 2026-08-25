import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MEMBER_STATUS_LABEL, MEMBER_STATUSES, isActiveMember, isSuspended, isWithdrawn,
  occupiesSeat, suspensionLabel, validateSuspension,
} from "@/lib/memberLifecycle";
import {
  PAYMENT_KINDS, PAYMENT_METHODS, formatYen, monthKeyOf, outstandingMembers,
  paidUserIdsIn, revenueByMonth, totalPaid, validateAmount, type MemberPayment,
} from "@/lib/memberPayments";

// 会員の在籍状態（休会・退会）と入金の記録の検査（2026-08-08）。
//
// ── 何を足したのか ──────────────────────────────────────────────
// 棚卸しで「経営の背骨」が丸ごと無いことが分かった。
//
//   売上         定価 × サイクル開始日の推計。入金の実績ではない
//   入金         profiles.paid_this_month（boolean）。**書き込む UI が1つも無かった**
//   在籍状態     status は 'active' のみ。休会が表現できない
//   退会         カルテごと物理削除する一択
//   契約・同意   記録する場所が無い
//   基本情報     電話番号・ふりがなの欄が無い
//
// ── ここで守っているもの ────────────────────────────────────────
// 1. 「席を食うか」の判断が DB とクライアントで食い違わないこと（下記の🔴）
// 2. 売上が推計に戻らないこと
// 3. 休会者が離脱アラート・更新催促・未記録リストに出ないこと
// 4. 入金・同意を書けるのがジム側だけであること
//
// 🔴 **`is_tenant_over_limit` は BEFORE INSERT トリガーから呼ばれる。**
//    人数の数え方を「締める方向」に変えると、そのジムの予約・トレ記録・食事記録が
//    全部通らなくなる。NULL の扱いを含めて DB とクライアントを固定する。
//
// ── 変異テスト（2026-08-08 実施・11件とも赤を確認）───────────────
//    1. is_tenant_over_limit に `status IS NULL OR` を足す      → 赤
//    2. is_tenant_over_limit から 'withdrawn' を落とす          → 赤
//    3. occupiesSeat(null) を true に変える                     → 赤
//    4. isActiveMember が休会を true にする                     → 赤
//    5. member_payments の INSERT を全員に開放する              → 赤
//    6. RESTRICTIVE の tenant_isolation を消す                  → 赤
//    7. ダッシュボードに推計売上を復活させる                    → 赤
//    8. useAllCustomerProfiles を .eq("status","active") に戻す → 赤
//    9. MemberInfoCard の upsert を update に戻す               → 赤
//   10. 中国語（簡体）の翻訳を1つ落とす                        → 赤
//   11. 休会者を離脱アラートから外すガードを消す                → 赤

const MIGRATION = "supabase/migrations/20260808030000_member_lifecycle_and_payments.sql";
const DASHBOARD = "src/components/trainer/TrainerDashboard.tsx";
const USE_PROFILE = "src/hooks/useProfile.ts";
const INFO_CARD = "src/components/trainer/clientDetail/MemberInfoCard.tsx";
const TYPES = "src/integrations/supabase/types.ts";
const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

const read = (p: string) => readFileSync(p, "utf8");
/** SQL のコメント行を落とす。説明文に書いた語句を「実装がある」と誤読しないため */
const stripSqlComments = (sql: string) =>
  sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

/**
 * TS/TSX のコメントを落とす。
 * この検査は「もう使っていない書き方」を禁止する形が多く、**禁止した理由を
 * コメントに書くとそのコメント自体に引っかかる**（2026-08-08 に4件やった）。
 * ブロックコメントと行コメントの両方を消してから中身を見る。
 */
const stripJsComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const payment = (over: Partial<MemberPayment>): MemberPayment => ({
  id: "p1", tenant_id: "t1", user_id: "u1", amount_yen: 10000,
  paid_on: "2026-08-01", method: "現金", kind: "月謝",
  plan_name: null, note: null, recorded_by: null, created_at: "2026-08-01T00:00:00Z",
  ...over,
});

// ---------------------------------------------------------------------------
// 席数の数え方（DB とクライアントを一致させる）
// ---------------------------------------------------------------------------
describe("🔴 席を食うかの判断は DB とクライアントで同じ", () => {
  const sql = stripSqlComments(read(MIGRATION));

  it("DB は cancelled と withdrawn の2つだけを除外する", () => {
    // 顧客と trainer の2箇所
    const matches = sql.match(/AND status NOT IN \('cancelled', 'withdrawn'\)/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("🔴 `status IS NULL OR` を足していない（足すと人数が増えてジムが止まる）", () => {
    // NULL の行は三値論理で元から数えられていない。数え始めるのは「締める方向」の変更で、
    // BEFORE INSERT トリガーから呼ばれるこの関数でやると予約が通らなくなる。
    expect(sql).not.toMatch(/status IS NULL OR status NOT IN/);
  });

  it("occupiesSeat が DB と同じ答えを返す（null を含めて）", () => {
    expect(occupiesSeat("active")).toBe(true);
    expect(occupiesSeat("suspended")).toBe(true);   // 休会は席を確保したまま
    expect(occupiesSeat("withdrawn")).toBe(false);
    expect(occupiesSeat("cancelled")).toBe(false);
    // 🔴 DB 側で NULL は数えられない。ここだけ true にするとズレる
    expect(occupiesSeat(null)).toBe(false);
    expect(occupiesSeat(undefined)).toBe(false);
  });

  it("休会は席を食う（全員休会にすれば上限を回避できる、にしない）", () => {
    expect(occupiesSeat("suspended")).toBe(true);
    // 関数の本体だけを見る。status の CHECK を付ける DO ブロックにも
    // `status NOT IN ('active','suspended',...)` があり、素で検索すると引っかかる。
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.is_tenant_over_limit[\s\S]*?\n\$\$;/);
    expect(body).toBeTruthy();
    expect(body![0]).not.toMatch(/'suspended'/);
  });

  it("EXECUTE を authenticated と anon から剥がしていない", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_tenant_over_limit\(uuid\) TO authenticated, anon;/,
    );
    expect(sql).not.toMatch(/REVOKE[\s\S]*is_tenant_over_limit/);
  });
});

// ---------------------------------------------------------------------------
// 在籍状態のロジック
// ---------------------------------------------------------------------------
describe("在籍状態の判定", () => {
  it("休会は「いま通っている人」ではない", () => {
    // 休会者を未記録リストや離脱アラートに入れると、毎月出続けて本物が埋もれる
    expect(isActiveMember("active")).toBe(true);
    expect(isActiveMember("suspended")).toBe(false);
    expect(isActiveMember("withdrawn")).toBe(false);
    expect(isActiveMember(null)).toBe(true); // 未設定は在籍扱い（表示のための既定）
  });

  it("退会の判定にレガシーの cancelled も含む", () => {
    expect(isWithdrawn("withdrawn")).toBe(true);
    expect(isWithdrawn("cancelled")).toBe(true);
    expect(isWithdrawn("suspended")).toBe(false);
    expect(isWithdrawn("active")).toBe(false);
  });

  it("休会だけを isSuspended が拾う", () => {
    expect(isSuspended("suspended")).toBe(true);
    expect(isSuspended("active")).toBe(false);
    expect(isSuspended("withdrawn")).toBe(false);
  });

  it("cancelled も「不明」ではなくラベルが出る", () => {
    expect(MEMBER_STATUS_LABEL.cancelled).toBeTruthy();
    expect(MEMBER_STATUS_LABEL.suspended).toBe("休会中");
  });
});

describe("休会期間の表示と検証", () => {
  it("開始だけ・終了だけ・両方の3通りを表現できる", () => {
    expect(suspensionLabel("2026-09-01", "2026-11-30")).toBe("2026/09/01 〜 2026/11/30");
    expect(suspensionLabel("2026-09-01", null)).toContain("2026/09/01");
    expect(suspensionLabel(null, null)).toBeNull();
  });

  it("replaceAll を使っていない（tsconfig の target/lib が ES2021 未満で落ちる）", () => {
    expect(read("src/lib/memberLifecycle.ts")).not.toMatch(/\.replaceAll\(/);
  });

  it("開始日は必須、終了日が開始より前なら弾く", () => {
    expect(validateSuspension("", "")).toBeTruthy();
    expect(validateSuspension("2026-09-01", "2026-08-01")).toBeTruthy();
    expect(validateSuspension("2026-09-01", "2026-09-01")).toBeNull(); // 同日は許す
    expect(validateSuspension("2026-09-01", "")).toBeNull();           // 期限未定は許す
  });

  it("DB 側の CHECK も残っている（画面のチェックだけにしない）", () => {
    expect(stripSqlComments(read(MIGRATION))).toMatch(/tenant_members_suspend_range/);
  });
});

// ---------------------------------------------------------------------------
// 入金の記録
// ---------------------------------------------------------------------------
describe("入金の金額", () => {
  it("0円は保存できるが、空・非数字・上限超えは弾く", () => {
    expect(validateAmount("0")).toBeNull();
    expect(validateAmount("12000")).toBeNull();
    expect(validateAmount("")).toBeTruthy();
    expect(validateAmount("１２０００")).toBeTruthy(); // 全角
    expect(validateAmount("-100")).toBeTruthy();
    expect(validateAmount("12,000")).toBeTruthy();
    expect(validateAmount("10000001")).toBeTruthy();
    expect(validateAmount("10000000")).toBeNull();     // 境界は通す
  });

  it("DB の CHECK と同じ上限（画面だけ緩い、にしない）", () => {
    expect(stripSqlComments(read(MIGRATION))).toMatch(/amount_yen >= 0 AND amount_yen <= 10000000/);
  });

  it("0円は「¥0」と出す（未入力と区別する）", () => {
    expect(formatYen(0)).toBe("¥0");
    expect(formatYen(12000)).toBe("¥12,000");
  });

  it("選べる名目・受け取り方が DB の CHECK と一致する", () => {
    const sql = stripSqlComments(read(MIGRATION));
    for (const m of PAYMENT_METHODS) expect(sql).toContain(`'${m}'`);
    for (const k of PAYMENT_KINDS) expect(sql).toContain(`'${k}'`);
  });
});

describe("売上の集計", () => {
  it("月ごとに合計する", () => {
    const map = revenueByMonth([
      payment({ id: "a", paid_on: "2026-08-01", amount_yen: 10000 }),
      payment({ id: "b", paid_on: "2026-08-31", amount_yen: 5000 }),
      payment({ id: "c", paid_on: "2026-07-15", amount_yen: 3000 }),
    ]);
    expect(map.get("2026-08")).toBe(15000);
    expect(map.get("2026-07")).toBe(3000);
    expect(map.get("2026-09")).toBeUndefined();
  });

  it("monthKeyOf / totalPaid", () => {
    expect(monthKeyOf("2026-08-31")).toBe("2026-08");
    expect(totalPaid([payment({ amount_yen: 100 }), payment({ id: "b", amount_yen: 250 })])).toBe(350);
  });

  it("その月に払った人だけを集合にする", () => {
    const s = paidUserIdsIn(
      [payment({ user_id: "u1", paid_on: "2026-08-02" }), payment({ id: "b", user_id: "u2", paid_on: "2026-07-02" })],
      "2026-08",
    );
    expect(s.has("u1")).toBe(true);
    expect(s.has("u2")).toBe(false);
  });

  it("🔴 ダッシュボードの売上が推計に戻っていない", () => {
    // 「定価 × サイクル開始日」で売上を作っていた関数。復活させないこと。
    // コメントでは名前を出して経緯を残しているので、コードだけを見る。
    const src = stripJsComments(read(DASHBOARD));
    expect(src).not.toMatch(/getRevenueCycleStartDates/);
    expect(src).toMatch(/useTenantPayments/);
  });
});

describe("今月の入金が未記録の一覧", () => {
  const members = [
    { user_id: "active-unpaid", name: "A", status: "active", planName: "月4回" },
    { user_id: "active-paid", name: "B", status: "active", planName: "月4回" },
    { user_id: "suspended", name: "C", status: "suspended", planName: "月4回" },
    { user_id: "no-plan", name: "D", status: "active", planName: null },
  ];
  const result = outstandingMembers({
    members,
    payments: [payment({ user_id: "active-paid", paid_on: "2026-08-03" })],
    monthKey: "2026-08",
    priceOf: () => 12000,
    isActive: isActiveMember,
  });

  it("払っていない在籍者だけが出る", () => {
    expect(result.map((r) => r.user_id)).toEqual(["active-unpaid"]);
  });

  it("休会者は出ない（払わなくて当然なので毎月出すとノイズになる）", () => {
    expect(result.some((r) => r.user_id === "suspended")).toBe(false);
  });

  it("プラン未設定は出ない（月謝の概念が無い＝未収と呼べない）", () => {
    expect(result.some((r) => r.user_id === "no-plan")).toBe(false);
  });

  it("見込み額を添えられる", () => {
    expect(result[0].expectedYen).toBe(12000);
  });

  it("「滞納」と断定しない（督促の根拠にしない）", () => {
    // ⚠️ 文言そのものを断言しない。兄弟アプリが `member` をオーバーレイすると落ちるため
    //    （forkHostileTests.test.ts の番人。2026-08-08 に実際に引っかかった）。
    //    ここで守るのは「断定する語を使わない」という方針だけ。
    const ja = JSON.parse(read("src/locales/ja.json")).member;
    for (const word of ["滞納", "未納", "延滞", "未払い"]) {
      expect(ja.unrecordedTitle, `タイトルに「${word}」を使わない`).not.toContain(word);
    }
    for (const word of ["滞納", "未納", "延滞"]) {
      expect(ja.unrecordedNote, `注記に「${word}」を使わない`).not.toContain(word);
    }
  });

  it("注記が画面に出ている（言い訳を書いて表示しない、をしない）", () => {
    expect(read(DASHBOARD)).toMatch(/t\("member\.unrecordedNote"\)/);
  });
});

// ---------------------------------------------------------------------------
// 書き込み権限（ここが緩むと記録の意味が無くなる）
// ---------------------------------------------------------------------------
describe("🔴 入金・同意を書けるのはジム側だけ", () => {
  const sql = stripSqlComments(read(MIGRATION));

  for (const table of ["member_payments", "member_agreements"]) {
    it(`${table}: RLS が有効で、テナント越えを RESTRICTIVE で塞いでいる`, () => {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(`CREATE POLICY tenant_isolation ON public\\.${table} AS RESTRICTIVE`),
      );
      expect(sql).toMatch(new RegExp(`tenant_id = public\\.get_my_tenant_id\\(\\)`));
    });

    it(`${table}: INSERT / UPDATE / DELETE が trainer 限定`, () => {
      for (const op of ["insert", "update", "delete"]) {
        const policy = sql.match(
          new RegExp(`CREATE POLICY ${table}_${op} ON public\\.${table}[\\s\\S]*?;`),
        );
        expect(policy, `${table}_${op} のポリシーが無い`).toBeTruthy();
        expect(policy![0]).toMatch(/has_role\(auth\.uid\(\), 'trainer'::app_role\)/);
        // お客様が自分の行として書けてしまう抜け道を作らない
        expect(policy![0]).not.toMatch(/auth\.uid\(\) = user_id/);
      }
    });

    it(`${table}: SELECT は本人かジム側`, () => {
      const policy = sql.match(
        new RegExp(`CREATE POLICY ${table}_select ON public\\.${table}[\\s\\S]*?;`),
      );
      expect(policy).toBeTruthy();
      expect(policy![0]).toMatch(/auth\.uid\(\) = user_id OR public\.has_role/);
    });
  }
});

// ---------------------------------------------------------------------------
// 画面側の取りこぼし防止
// ---------------------------------------------------------------------------
describe("休会者が画面から消えない・不当に催促されない", () => {
  it("🔴 顧客一覧が休会も取ってくる（active だけに戻さない）", () => {
    // 元の書き方（.eq）はコメントで経緯として残してあるので、コードだけを見る
    const src = stripJsComments(read(USE_PROFILE));
    expect(src).toMatch(/\.in\("status", \["active", "suspended"\]\)/);
    const fn = src.slice(src.indexOf("useAllCustomerProfiles"));
    expect(fn).not.toMatch(/\.eq\("status", "active"\)/);
  });

  it("休会者を離脱アラート・更新催促から外している", () => {
    const src = read(DASHBOARD);
    // どちらのループにも isActiveMember のガードが要る
    expect((src.match(/if \(!isActiveMember\(p\.status\)\) return;/g) ?? []).length).toBe(2);
  });

  it("在籍状態が useProfile の型に載っている", () => {
    const src = read(USE_PROFILE);
    for (const col of ["status", "suspended_from", "suspended_until", "phone", "name_kana"]) {
      expect(src).toContain(col);
    }
  });
});

describe("profiles の行はトリガーが作ってくれない", () => {
  it("🔴 連絡先の保存が upsert（update だと 0行更新で黙って消える）", () => {
    const src = read(INFO_CARD);
    expect(src).toMatch(/from\("profiles"\)\.upsert\(|from\("profiles"\)\s*\.upsert\(/);
    expect(src).toMatch(/onConflict: "user_id"/);
  });
});

// ---------------------------------------------------------------------------
// スキーマ・翻訳
// ---------------------------------------------------------------------------
describe("スキーマと翻訳が追従している", () => {
  it("types.ts に新しいテーブルが載っている", () => {
    const src = read(TYPES);
    expect(src).toMatch(/\n {6}member_payments: \{/);
    expect(src).toMatch(/\n {6}member_agreements: \{/);
  });

  it("profiles / tenant_members の新しい列が types.ts に載っている", () => {
    const src = read(TYPES);
    for (const col of ["phone", "name_kana", "suspended_from", "suspended_until", "withdrawn_on", "withdrawal_reason"]) {
      expect(src).toContain(col);
    }
  });

  it("5言語すべてに member の翻訳があり、キーが揃っている", () => {
    const base = Object.keys(JSON.parse(read("src/locales/ja.json")).member).sort();
    expect(base.length).toBeGreaterThan(50);
    for (const loc of LOCALES) {
      const ns = JSON.parse(read(`src/locales/${loc}.json`)).member;
      expect(ns, `${loc} に member が無い`).toBeTruthy();
      expect(Object.keys(ns).sort(), `${loc} のキーがズレている`).toEqual(base);
      for (const [k, v] of Object.entries(ns)) {
        expect(typeof v === "string" && v.trim().length > 0, `${loc}.member.${k} が空`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 「決済ではない」ことを取り違えない
// ---------------------------------------------------------------------------
describe("これは記録であって決済ではない", () => {
  it("入金の記録から Stripe を呼んでいない", () => {
    for (const f of [
      "src/lib/memberPayments.ts",
      "src/hooks/useMemberPayments.ts",
      "src/components/trainer/clientDetail/MemberPaymentsSection.tsx",
    ]) {
      // 「Stripe ではない」と書いた説明が引っかかるので、コードだけを見る
      expect(stripJsComments(read(f))).not.toMatch(/stripe|create-checkout/i);
    }
  });

  it("同意書そのものではない旨の注記が画面に出ている", () => {
    // 文言は兄弟アプリがオーバーレイしうるので中身は断言せず、
    // 「注記を表示していること」だけを固定する。
    expect(read("src/components/trainer/clientDetail/MemberAgreementsSection.tsx"))
      .toMatch(/t\("member\.agreementsNote"\)/);
  });
});

// ---------------------------------------------------------------------------
// 🔴 休会・退会が DB に書けること（2026-08-25 に本番で書けていなかった）
//
// tenant_members.status に CHECK が2本付いていて、通る値が積集合になっていた:
//   tenant_members_status_check … ('active','paused','cancelled')      ← 作成時のもの
//   tenant_members_status_known … (NULL,'active','suspended','withdrawn','cancelled')
// 実際に書けるのは active と cancelled だけで、8/8 に休会・退会を出してから
// カルテの「休会にする」「退会にする」は押すたびに check_violation で失敗していた。
// 本番の status は全72行が active のまま（＝誰も休会にできていない）。
// ---------------------------------------------------------------------------
describe("🔴 在籍状態は DB に書ける値と一致していること", () => {
  const FIX = "supabase/migrations/20260825000500_fix_member_status_check.sql";
  const fix = read(FIX);

  it("古い CHECK（'paused' 版）を外す migration がある", () => {
    expect(fix).toMatch(/DROP CONSTRAINT tenant_members_status_check/);
  });

  it("休会・退会を許す CHECK は残す", () => {
    expect(fix).toMatch(/tenant_members_status_known/);
    expect(fix).toMatch(/'suspended'/);
    expect(fix).toMatch(/'withdrawn'/);
  });

  it("画面が書く値が、DB が許す集合に収まっている", () => {
    // MEMBER_STATUSES を増やしたのに CHECK を直し忘れる、を防ぐ
    const allowed = fix.match(/CHECK \(status IS NULL OR status IN \(([^)]*)\)\)/)?.[1] ?? "";
    const set = new Set(allowed.split(",").map((s) => s.trim().replace(/'/g, "")));
    for (const s of MEMBER_STATUSES) {
      expect(set.has(s), `status='${s}' を DB が受け付けない`).toBe(true);
    }
  });

  it("使っていない 'paused' をアプリ側に戻さない", () => {
    // 'paused' は元の CHECK にしか無い語で、src のどこでも使っていない
    expect(MEMBER_STATUSES).not.toContain("paused" as never);
  });
});
