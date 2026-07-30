/**
 * 未確認のまま「別のロールで登録し直す」ことを検知するための、ブラウザローカルの記録。
 *
 * Supabase(gotrue) は、未確認の既存ユーザーに signUp を再実行しても user_metadata を
 * 更新しない（本人確認ができないため、意図的にそう作られている）。つまり最初にお客様
 * タブで登録してしまうと、後からジムオーナータブで登録し直しても確認メールは飛ぶが
 * ロールは customer のまま固定される。しかも API のレスポンスだけでは新規登録との
 * 区別が付かない（どちらも同じ形で返る）ため、この端末での直近の登録試行をローカルに
 * 覚えておいて検知する。
 *
 * 別ブラウザ・別端末からの再登録は検知できない。あくまで「同じ端末でタブを間違えて
 * 登録し直す」という最も起きやすい事故を防ぐための保険。
 */

const STORAGE_KEY = "gymboard_pending_signup";
const TTL_MS = 24 * 60 * 60 * 1000;

export type PendingRole = "customer" | "trainer";

interface PendingSignup {
  email: string;
  role: PendingRole;
  ts: number;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** 未確認のまま送信できた（＝新規に確認メールが飛んだ）ことを記録する。 */
export function rememberPendingSignup(email: string, role: PendingRole): void {
  try {
    const record: PendingSignup = { email: normalizeEmail(email), role, ts: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage が使えない環境（プライベートブラウズ等）では黙って諦める。
    // この機能はあくまで保険なので、失敗しても登録自体は続行してよい。
  }
}

/**
 * 同じメールアドレスで、直近に別ロールとして登録手続き中でないかを確認する。
 * 該当すればそのロールを返す（呼び出し側は signUp を送らず案内に差し替える）。
 * 該当しなければ null。
 */
export function findConflictingPendingRole(
  email: string,
  aboutToSubmitRole: PendingRole,
): PendingRole | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as PendingSignup;
    if (Date.now() - record.ts > TTL_MS) return null;
    if (record.email !== normalizeEmail(email)) return null;
    if (record.role === aboutToSubmitRole) return null;
    return record.role;
  } catch {
    return null;
  }
}

/** ログイン成功時など、もう追跡が不要になったら呼ぶ。 */
export function clearPendingSignup(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
