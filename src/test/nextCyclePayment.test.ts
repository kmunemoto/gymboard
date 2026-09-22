import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NEXT_CYCLE_PAYMENT_CODE,
  formatCycleRange,
  isBlockedByNextCyclePayment,
  isNextCyclePaymentError,
} from "@/lib/nextCyclePayment";

// ────────────────────────────────────────────────────────────────
// 次回分の入金が確認できるまで、次回分の予約を受け付けない（2026-09-22 宗本さん）
//
// > 次回分の料金を払ってないと次回分の予約が取れないようにするシステム。
// > 今回の最後の予約時に次回の支払いをしてもらい、次回分の予約が取れるようになる。
// > まだ今回の予約の途中だけど次回分の予約を取りたいなら……支払う。
//
// 🔴 この機能で壊しやすいものが3つある。どれも**静かに効かなくなる**か**全員止まる**。
//
//   1. ONにした日（`_since`）を書き忘れる → **在籍会員が全員まとめて予約できなくなる**。
//      本番の自社ジムで 38 人。ONにした瞬間に電話が鳴る類の事故。
//   2. 判定を画面側に写す → DB（GB009）とズレて「取れると見せたのに断られる」。
//      規則は `member_first_unpaid_cycle_start` 1本だけに置く。
//   3. 店側の代理予約まで止める → 「払い忘れたけど次回もらう」ができなくなる。
//      GB003/GB004/GB006/GB007 と同じ非対称を守る。
// ────────────────────────────────────────────────────────────────

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

/** SQL のコメント（`--`）を落とす。コメントの語に当たって空振りするのを防ぐ。 */
const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const MIGRATION = "supabase/migrations/20260922010000_next_cycle_payment_gate.sql";
const sql = stripSql(readFileSync(MIGRATION, "utf8"));
const read = (p: string) => stripJs(readFileSync(p, "utf8"));

const CARD = "src/components/trainer/NextCyclePaymentCard.tsx";
const TOGGLE = "src/components/trainer/clientDetail/NextCyclePaymentToggle.tsx";
const HOOK = "src/hooks/useMemberNextCycleGate.ts";
const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

describe("断られたときの見分け", () => {
  it("GB009 は次回分の未入金", () => {
    expect(NEXT_CYCLE_PAYMENT_CODE).toBe("GB009");
    expect(isNextCyclePaymentError({ code: "GB009" })).toBe(true);
  });

  it("他の理由を巻き込まない", () => {
    for (const code of ["GB004", "GB007", "GB008", "P0001"]) {
      expect(isNextCyclePaymentError({ code }), code).toBe(false);
    }
    expect(isNextCyclePaymentError(null)).toBe(false);
    expect(isNextCyclePaymentError({ message: "network" })).toBe(false);
  });
});

describe("その日は入金待ちで取れないか", () => {
  it("gate の日から後（当日を含む）は取れない", () => {
    expect(isBlockedByNextCyclePayment("2026-10-18", "2026-10-18")).toBe(true);
    expect(isBlockedByNextCyclePayment("2026-10-18", "2026-11-01")).toBe(true);
  });

  it("gate より前は取れる", () => {
    expect(isBlockedByNextCyclePayment("2026-10-18", "2026-10-17")).toBe(false);
    expect(isBlockedByNextCyclePayment("2026-10-18", "2026-09-30")).toBe(false);
  });

  it("🔴 gate が読めなければ何も止めない（安全側）", () => {
    // 読めなかったときに止める側へ倒すと、通信が一瞬こけただけで予約できない画面になる。
    // 最終判定は DB の GB009 が持っているので、画面が緩くても抜け道にならない。
    expect(isBlockedByNextCyclePayment(null, "2099-01-01")).toBe(false);
    expect(isBlockedByNextCyclePayment(undefined, "2099-01-01")).toBe(false);
    expect(isBlockedByNextCyclePayment("", "2099-01-01")).toBe(false);
    expect(isBlockedByNextCyclePayment("2026-10-18", "")).toBe(false);
  });
});

describe("期間の見せ方", () => {
  it("🔴 窓の終わりは含まないので、表示は前日にする", () => {
    // [2026-10-18, 2026-11-19) は「10/18〜11/18」。そのまま出すと1日先に見える
    expect(formatCycleRange("2026-10-18", "2026-11-19")).toBe("10/18〜11/18");
    expect(formatCycleRange("2026-09-17", "2026-10-18")).toBe("9/17〜10/17");
  });

  it("月をまたがない窓・読めない値", () => {
    expect(formatCycleRange("2026-10-18", "2026-10-25")).toBe("10/18〜10/24");
    expect(formatCycleRange(null, "2026-11-19")).toBe("");
    expect(formatCycleRange("2026-10-18", null)).toBe("");
  });
});

describe("🔴 DB 側（migrations）", () => {
  it("GB009 で断っている", () => {
    expect(sql).toMatch(/ERRCODE\s*=\s*'GB009'/);
  });

  it("予約テーブルにトリガーが付いている（INSERT と UPDATE の両方）", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_guard_booking_next_cycle_payment/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.bookings/);
  });

  it("🔴 店側の代理予約は止めない（auth.uid() と user_id が違えば素通し）", () => {
    expect(sql).toMatch(/v_actor IS NULL OR v_actor IS DISTINCT FROM NEW\.user_id/);
  });

  it("🔴 ONにした日までに始まっていた窓は払い済み扱い（全員が同時に止まらない）", () => {
    expect(sql).toContain("next_cycle_payment_required_since");
    expect(sql, "since との比較が無い＝ONにした瞬間に全員止まる").toMatch(/v_ws <= v_since/);
  });

  it("設定は既定 OFF（他のジムに何も起きない）", () => {
    expect(sql).toMatch(/next_cycle_payment_required boolean NOT NULL DEFAULT false/);
  });

  it("同じサイクルを二重に入金済みにできない", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,120}member_payments_cycle_unique/);
    expect(sql).toMatch(/WHERE covers_cycle_start IS NOT NULL/);
  });

  it("🔴 規則は1本。トリガーも RPC も同じ関数を呼ぶ（写していない）", () => {
    const guard = /CREATE OR REPLACE FUNCTION public\.guard_booking_next_cycle_payment[\s\S]*?\$function\$;/.exec(sql);
    expect(guard, "トリガー関数が読めない").not.toBeNull();
    expect(guard![0], "判定を写している").toContain("member_first_unpaid_cycle_start");
    const rpc = /CREATE OR REPLACE FUNCTION public\.get_my_next_cycle_payment_gate[\s\S]*?\$function\$;/.exec(sql);
    expect(rpc![0]).toContain("member_first_unpaid_cycle_start");
  });

  it("サブスク以外（回数券・期間制）は対象外（窓が合わない）", () => {
    expect(sql).toMatch(/COALESCE\(v_ptype, 'subscription'\) <> 'subscription'/);
  });

  it("他人の入金状況を覗けない（店側の口は共通の番人を通す）", () => {
    expect(sql).toContain("PERFORM public.assert_can_act_for(p_user_id);");
  });
});

describe("🔴 店の設定（NextCyclePaymentCard）", () => {
  const code = read(CARD);

  it("🔴 ONにするときは「ONにした日」を必ず一緒に書く", () => {
    // ここを落とすと、ONにした瞬間に在籍会員が全員まとめて予約できなくなる
    expect(code).toMatch(/next_cycle_payment_required:\s*true,\s*next_cycle_payment_required_since:\s*getJSTToday\(\)/);
  });

  it("OFF にするときは since を消さない（次のONでまた全員止まるため）", () => {
    const off = /\{ next_cycle_payment_required: false[^}]*\}/.exec(code);
    expect(off, "OFF の分岐が読めない").not.toBeNull();
    expect(off![0]).not.toContain("_since");
  });

  it("列が読めない環境では OFF に倒れる", () => {
    expect(code).toContain('tenant?.next_cycle_payment_required === true');
  });

  it("設定画面に置かれている", () => {
    expect(read("src/components/trainer/TrainerGymSettings.tsx")).toContain("<NextCyclePaymentCard />");
  });
});

describe("🔴 カルテのトグル（NextCyclePaymentToggle）", () => {
  const code = read(TOGGLE);

  it("設定 OFF の店には出さない", () => {
    expect(code).toContain("tenant?.next_cycle_payment_required === true");
    expect(code).toMatch(/if \(!required \|\| loading \|\| !gate\) return null;/);
  });

  it("🔴 素の ON/OFF ではなく「どのサイクル分か」を出す（期間つきラベル）", () => {
    // 期間を出さないと、店は何を確認して押したのか分からない。
    // そして中身がサイクルに紐づく行でないと、毎月手で戻すことになり必ず忘れる。
    expect(code).toContain("formatCycleRange(gate.cycleStart, gate.cycleEnd)");
    expect(code).toMatch(/memberToggleLabel", \{ range \}/);
  });

  it("カルテに置かれている", () => {
    expect(read("src/components/trainer/clientDetail/MemberPaymentsSection.tsx"))
      .toContain("<NextCyclePaymentToggle");
  });

  it("🔴 入金は「どのサイクル分か」を持って保存される", () => {
    expect(read(HOOK)).toContain("covers_cycle_start: gate.cycleStart");
  });

  it("🔴 読めなくても画面を落とさない（effect の中で投げない）", () => {
    // ここを素の await にしていたら、テストの supabase モックに rpc が無い環境で
    // effect から例外が飛び、it() は緑のまま vitest が exit 1 した（2026-09-22）
    const hook = read(HOOK);
    expect(hook).toMatch(/try \{[\s\S]{0,400}supabase\.rpc\("get_member_next_cycle_gate"/);
    expect(hook).toMatch(/\} catch \{[\s\S]{0,40}row = null;/);
  });
});

describe("文言（5言語）", () => {
  for (const lang of LOCALES) {
    it(`${lang} に設定とトグルの文言がある`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      for (const k of ["nextCyclePaymentLabel", "nextCyclePaymentDesc", "nextCyclePaymentWarning", "nextCyclePaymentSection"]) {
        expect(json.settings?.trainer?.[k], `${lang}.json settings.trainer.${k}`).toBeTruthy();
      }
      for (const k of ["memberToggleLabel", "payTitle", "undoTitle", "errorUnpaid"]) {
        expect(json.nextCyclePayment?.[k], `${lang}.json nextCyclePayment.${k}`).toBeTruthy();
      }
    });

    it(`${lang} のラベルは期間（{{range}}）を出す`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      expect(json.nextCyclePayment.memberToggleLabel).toContain("{{range}}");
    });
  }
});
