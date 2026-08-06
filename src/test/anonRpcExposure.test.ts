import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { MIGRATIONS_DIR, stripSqlComments } from "./helpers/rlsPolicies";

// anon から呼べる SECURITY DEFINER 関数を増やさないための検査。
//
// ── 背景 ────────────────────────────────────────────────────────
// 2026-08-06、本番DBを実測したところ **37件**が
// 「anon から EXECUTE でき、関数内に auth.uid() のチェックが無い」状態だった。
// `anon` キーは全クライアントに埋め込まれているので**ログイン不要で叩ける。**
//
//   buy_shop_item(p_user_id, ...)  他人のコインで買い物させ、残高を0にできる
//   complete_dungeon_run(..., p_total_coins, p_total_exp)  数値を引数でそのまま渡せる
//   get_ranking(p_type, p_gender)  全ジムの会員の user_id 一覧が取れる
//                                  → 「他人の user_id」の入手元になる
//   get_booked_slots(check_date)   **全テナントの**予約表が日付指定で取れる
//
// **共通の形は「user_id を引数で受け取り、呼び出し元と突き合わせていない」。**
//
// ── この検査で見るもの ──────────────────────────────────────────
// 実際の ACL は DB にしか無いので、CI からは見えない（穴6・穴7と同じ層）。
// ここで見るのは**マイグレーションの側**:
//
//   1. 公開が仕様の関数を、うっかり REVOKE していないか
//   2. 危険な関数を REVOKE から取りこぼしていないか
//   3. has_role を authenticated から剥がしていないか（**アプリ全体が即死する**）
//
// 実DBの確認は `security/check.sql` の検査5、または
// `scripts/check-schema-applied.mjs` が出す SQL で行う。
//
// ── 変異テスト（2026-08-06 実施・4件とも赤を確認）────────────────
//   1. get_tenant_public を REVOKE 対象に足す            → 赤（予約ページが壊れる）
//   2. buy_shop_item を REVOKE 対象から外す              → 赤
//   3. has_role を authenticated からも剥がす            → 赤
//   4. ポリシーを絞る手順（1章）を消す                    → 赤

const MIGRATION = "20260806120000_revoke_anon_security_definer.sql";

/**
 * **anon から呼べて正しい関数。**
 * ログイン前の画面（体験予約・ドロップイン予約・招待リンク）が使う。
 * ⚠️ ここに載っているものを「安全のため」と言って塞がないこと。
 *    塞ぐと**未ログインの予約ページが真っ白になる。**
 */
const MUST_KEEP_ANON = [
  "get_tenant_public",
  "get_tenant_booked_slots",
  "lookup_tenant_by_invite_code",
];

/** anon から叩けてはいけない関数（本番で実測した危険なもの） */
const MUST_REVOKE_ANON = [
  "buy_shop_item",
  "buy_gacha_ticket",
  "buy_stamina",
  "complete_dungeon_run",
  "grant_equipment",
  "grant_companion_exp",
  "claim_daily_login_bonus",
  "feed_companion",
  "hatch_companion_egg",
  "start_dungeon_run",
  "set_active_companion",
  "recover_stamina",
  "get_ranking",
  "get_booked_slots",
  "get_trainer_ids",
  "get_login_bonus_status",
  "_quest_condition_values",
  "check_weight_milestones",
  "check_collection_milestones",
  "check_training_milestones",
  "apply_raid_damage",
  "process_session_rewards",
  "update_event_progress",
  "lookup_tenant_by_staff_invite_code",
];

const migrationSql = () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f === MIGRATION);
  expect(files.length, `${MIGRATION} がありません`).toBe(1);
  return stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${MIGRATION}`, "utf8"));
};

/** REVOKE の対象として列挙されている関数名 */
const revokedNames = (sql: string) =>
  new Set([...sql.matchAll(/'public\.(\w+)\([^)]*\)'/g)].map((m) => m[1]));

describe("anon から呼べる SECURITY DEFINER 関数", () => {
  const sql = migrationSql();
  const revoked = revokedNames(sql);

  it("危険な関数がすべて REVOKE の対象に入っている", () => {
    const missing = MUST_REVOKE_ANON.filter((f) => !revoked.has(f));
    expect(
      missing,
      `anon から叩ける危険な関数が REVOKE から漏れています: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("公開が仕様の関数を REVOKE していない", () => {
    const broken = MUST_KEEP_ANON.filter((f) => revoked.has(f));
    expect(
      broken,
      `ログイン前の画面が使う関数を塞いでいます。未ログインの予約ページが` +
        `真っ白になります: ${broken.join(", ")}`,
    ).toEqual([]);
  });

  it("🔴 has_role を authenticated から剥がしていない", () => {
    // 実測で 104 件のポリシーが has_role を使っている。剥がすとアプリ全体が即死する。
    const authRevokes = [...sql.matchAll(/FROM PUBLIC, anon, authenticated/g)].length;
    expect(authRevokes, "authenticated を剥がす節が1つも無い（空振り）").toBeGreaterThan(0);

    // has_role が「anon だけ剥がす」側の配列にあること
    const anonOnlyBlock = sql.slice(sql.lastIndexOf("FROM PUBLIC, anon'") - 4000);
    const hasRoleInAuthRevoke = /'public\.has_role\([^)]*\)'[\s\S]{0,2000}?FROM PUBLIC, anon, authenticated/.test(sql);
    expect(
      hasRoleInAuthRevoke,
      "has_role を authenticated からも剥がしています。104件のポリシーが使っており、" +
        "アプリ全体が即死します",
    ).toBe(false);
    expect(anonOnlyBlock).toContain("has_role");
  });

  it("REVOKE の前にポリシーを authenticated に絞っている", () => {
    // 順序を逆にすると、anon がそのテーブルを読んだときに 0件ではなく
    // permission denied for function has_role が返る
    const alterIdx = sql.indexOf("ALTER POLICY");
    const revokeIdx = sql.indexOf("REVOKE EXECUTE");
    expect(alterIdx, "ポリシーを絞る手順がありません").toBeGreaterThan(-1);
    expect(
      alterIdx < revokeIdx,
      "ポリシーを絞る前に REVOKE しています。anon にエラーが返るようになります",
    ).toBe(true);
  });

  it("存在しない関数で落ちないようガードしている", () => {
    // 兄弟アプリはゲーミフィケーションを持たない構成がある
    expect(sql).toContain("to_regprocedure");
  });
});
