// 通知の送信履歴（email_send_log）の読み取り。
//
// なぜ要るか: お客様から「予約のメールが来ていない」と言われたとき、
// これまで店は**何も確認できなかった**。届いたのか・配信停止で止まったのか・
// そもそも送っていないのかが、こちらに問い合わせないと分からなかった。
//
// 🔴 取得は必ず tenant_id で絞る。RLS も同テナントに絞っているが二重の防御にする
//    （書き出し側 gymDataExport.ts と同じ方針）。

import { supabase } from "@/integrations/supabase/client";

/** 1回に読む件数。履歴は「最近どうだったか」を見るものなので深追いしない。 */
export const LOG_PAGE = 50;

/** 店の判断に効く区分。色分けはこの3つで足りる。 */
export type LogTone = "ok" | "warn" | "bad";

/**
 * 状態を3つに畳む。
 *
 * ⚠️ 未知の値が来ても落とさないこと（DB 側が先に増えることがある）。
 *    知らない状態は warn に倒す（「届いた」と言い切らない側に寄せる）。
 */
export const toneOf = (status: string): LogTone => {
  if (status === "sent") return "ok";
  // 届いていないが、店が知って動く必要があるもの
  if (status === "bounced" || status === "failed" || status === "dlq" || status === "rejected") {
    return "bad";
  }
  // 途中・意図的に止めたもの（配信停止・重複・送信中）
  return "warn";
};

export interface EmailLogRow {
  id: string;
  created_at: string;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
}

export interface LoadLogOptions {
  /** この宛先だけに絞る（カルテから「この人宛の履歴」を見るとき） */
  recipientEmail?: string;
  /** 何件目から（もっと見る） */
  offset?: number;
}

/**
 * そのジムの送信履歴を新しい順に読む。
 *
 * ⚠️ 認証メール（新規登録・パスワード再設定）は**出ない**。ジムに属さないので
 *    tenant_id が NULL で、RLS が弾く。店に見せる意味も無い。
 */
export const loadEmailLog = async (
  tenantId: string,
  opts: LoadLogOptions = {},
): Promise<EmailLogRow[]> => {
  const from = opts.offset ?? 0;
  let q = supabase
    .from("email_send_log")
    .select("id, created_at, template_name, recipient_email, status, error_message")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, from + LOG_PAGE - 1);

  if (opts.recipientEmail) q = q.eq("recipient_email", opts.recipientEmail);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as EmailLogRow[];
};

/** 畳んだあとの1行。 */
export interface EmailLogEntry extends EmailLogRow {
  /** 同じ宛先・同じ種別・同じ日で積まれた行数（再試行の回数の目安） */
  attempts: number;
}

/**
 * 同じ通知が複数行に散るので、**1通ぶんを1行に畳む**。
 *
 * 1通のメールは pending → sent（失敗すると failed ×N → dlq）と行を残す。
 * 畳まないと「20件送ったのに履歴が60行」になって、店には何が起きたか読めない。
 * 店が見たいのは「最終的にどうなったか」なので、
 * 宛先＋種別＋日付が同じ行のうち**一番新しいものだけ**を残す。
 *
 * ⚠️ 入力は新しい順に並んでいる前提（loadEmailLog がそう返す）。
 *    並びが変わると「最初に見たものが最終状態」が崩れる。
 */
export const collapseLog = (rows: readonly EmailLogRow[]): EmailLogEntry[] => {
  const out: EmailLogEntry[] = [];
  const seen = new Map<string, EmailLogEntry>();
  for (const r of rows) {
    const key = JSON.stringify([r.recipient_email, r.template_name, r.created_at.slice(0, 10)]);
    const hit = seen.get(key);
    if (hit) {
      hit.attempts += 1;
      continue;
    }
    const entry: EmailLogEntry = { ...r, attempts: 1 };
    seen.set(key, entry);
    out.push(entry);
  }
  return out;
};
