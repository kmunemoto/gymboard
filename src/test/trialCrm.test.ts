import { readFileSync, readdirSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_STATUSES, TRIAL_PAGE, normalizeStatus,
} from "@/components/trainer/TrainerTrialFollowUps";

// 体験CRM の強化（2026-08-26）の見張り。
//
// 本番を見て分かったこと:
//   ・体験予約70件すべてが「未対応」のまま。メモも0件（＝フォローが記録されていない）
//   ・🔴 send-trial-reminders に cron が無く、前日リマインドが**一度も飛んでいない**
//
// 🔴 ここで守っている不変条件:
//   1. 体験リマインドの定期実行が登録されている
//   2. DB に入る follow_up_status はコードだけ（日本語を復活させない）
//   3. 公開済みのアプリが日本語を書いても保存が落ちない
//   4. 一覧が無制限に伸びない

const MIGRATION = "supabase/migrations/20260826040000_trial_crm.sql";
const SCREEN = "src/components/trainer/TrainerTrialFollowUps.tsx";

describe("migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("最新の migration に含まれている", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("20260826040000_trial_crm.sql");
  });

  it("🔴 体験リマインドの定期実行を登録する", () => {
    // 関数はデプロイ済みなのに cron が無く、一度も動いていなかった
    expect(sql).toMatch(/cron\.schedule\(\s*\n?\s*'send-trial-reminders-daily'/);
    expect(sql).toContain("'/send-trial-reminders'");
    // 🔴 呼び先は vault から読む。project ref を焼き込むと、兄弟アプリが
    //    この migration をコピーした瞬間、通知がジムボードのプロジェクトへ飛ぶ
    expect(sql).toMatch(/vault\.decrypted_secrets[\s\S]{0,120}project_functions_url/);
    expect(sql).not.toMatch(/[a-z]{20}\.supabase\.co/);
    // 認証は既存の cron と同じ（vault の cron_secret）
    expect(sql).toContain("x-cron-secret");
    expect(sql).toMatch(/vault\.decrypted_secrets WHERE name = 'cron_secret'/);
  });

  it("既に登録済みなら作り直さない（冪等）", () => {
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM cron\.job WHERE jobname = 'send-trial-reminders-daily'\)/);
  });

  it("pg_cron が無い環境でも落ちない", () => {
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\)/);
  });

  it("既存の日本語の値をコードに直す", () => {
    const upd = sql.slice(sql.indexOf("UPDATE public.trial_bookings"), sql.indexOf("ALTER TABLE public.trial_bookings"));
    for (const [ja, code] of [["未対応", "pending"], ["来店した", "visited"], ["入会した", "joined"], ["見送り", "declined"]]) {
      expect(upd).toContain(`WHEN '${ja}'`);
      expect(upd).toContain(`'${code}'`);
    }
  });

  it("🔴 入口で日本語をコードに直すトリガーがある（古いアプリを壊さない）", () => {
    // 端末に配ったアプリは書き換えられない。CHECK をコードだけにするなら、
    // 入口で翻訳しないと古いアプリからの保存が全部落ちる
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.normalize_trial_follow_up_status/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF follow_up_status ON public\.trial_bookings/);
  });

  it("🔴 想定外の値でも保存を落とさない（既定に倒す）", () => {
    // ここで例外を投げると、店は原因の分からないエラーを見ることになる
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.normalize_trial_follow_up_status"));
    expect(fn.slice(0, 1200)).toMatch(/NEW\.follow_up_status := 'pending'/);
    expect(fn.slice(0, 1200)).not.toMatch(/RAISE EXCEPTION/);
  });

  it("CHECK はコードだけを許す", () => {
    expect(sql).toMatch(/CHECK \(follow_up_status IN \('pending', 'visited', 'joined', 'declined'\)\)/);
  });

  it("追えるようにする列を足す", () => {
    for (const c of ["followed_up_at", "source", "declined_reason"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
  });

  it("自由入力には上限を切る", () => {
    expect(sql).toMatch(/char_length\(source\) <= 100/);
    expect(sql).toMatch(/char_length\(declined_reason\) <= 500/);
  });
});

describe("🔴 画面側の値はコード", () => {
  const src = readFileSync(SCREEN, "utf8");
  const dash = readFileSync("src/components/trainer/TrainerDashboard.tsx", "utf8");

  it("状態の一覧がコードになっている", () => {
    expect([...FOLLOW_UP_STATUSES]).toEqual(["pending", "visited", "joined", "declined"]);
  });

  it("日本語のリテラルで比較していない", () => {
    // 互換用の対応表（LEGACY_STATUS）だけは日本語を持ってよい
    const withoutLegacy = src.slice(0, src.indexOf("const LEGACY_STATUS"))
      + src.slice(src.indexOf("export const normalizeStatus"));
    for (const ja of ["未対応", "来店した", "入会した", "見送り"]) {
      expect(withoutLegacy, `${ja} で比較している`).not.toContain(`"${ja}"`);
    }
  });

  it("ダッシュボードのフォロー待ち件数もコードで数える", () => {
    // ここが日本語のままだと、コード化した瞬間に件数が常に0になる（静かな劣化）
    expect(dash).toContain('.eq("follow_up_status", "pending")');
    expect(dash).not.toContain('.eq("follow_up_status", "未対応")');
  });

  it("古い日本語の値も読める（トリガー適用前の行のため）", () => {
    expect(normalizeStatus("未対応")).toBe("pending");
    expect(normalizeStatus("入会した")).toBe("joined");
    expect(normalizeStatus("見送り")).toBe("declined");
  });

  it("コードはそのまま通す", () => {
    for (const s of FOLLOW_UP_STATUSES) expect(normalizeStatus(s)).toBe(s);
  });

  it("🔴 知らない値・空を pending に倒す（生の文字列を画面に出さない）", () => {
    expect(normalizeStatus("なにか")).toBe("pending");
    expect(normalizeStatus(null)).toBe("pending");
    expect(normalizeStatus(undefined)).toBe("pending");
  });
});

describe("フォロー日", () => {
  const src = readFileSync(SCREEN, "utf8");

  it("状態を変えたら対応時刻も一緒に記録する", () => {
    // 状態だけでは「何日放置されているか」が見えない
    expect(src).toMatch(/followed_up_at: followedUpAt/);
  });

  it("未対応に戻したら時刻を消す", () => {
    expect(src).toMatch(/status === "pending" \? null : new Date\(\)\.toISOString\(\)/);
  });
});

describe("一覧が無制限に伸びない", () => {
  const src = readFileSync(SCREEN, "utf8");

  it("件数の上限がある", () => {
    expect(TRIAL_PAGE).toBeGreaterThan(0);
    expect(src).toMatch(/\.limit\(TRIAL_PAGE\)/);
  });

  it("select(\"*\") をやめている", () => {
    const q = src.slice(src.indexOf('.from("trial_bookings")'));
    expect(q.slice(0, 800)).not.toContain('.select("*")');
  });

  it("上限に達したことを黙って隠さない", () => {
    // 出さないと「古い体験が消えた」と誤解される
    expect(src).toContain("trialFollowUp.limited");
  });
});
