// 体験予約・ドロップイン（未ログインの入力）の守り（2026-11-01・点検 trial-book-1 / trial-book-2 / drop-in-book-1）。
//
// お名前（guest_name）は、お客様宛ての確認メール・店宛てのメール・公式 LINE・Google カレンダー・当日のサマリーに
// そのまま入る。未ログインで誰でも入れられるので、URL・メールアドレス・改行を入れると、正規のドメイン・
// 公式アカウントから偽の案内（「こちらから手続きを」）を送れた・通知の行を偽れた。
//
// 確認メールは入力されたアドレスへ正規のドメインから届くので、回数の上限が「メールの中継」の上限になる。
// 今までの上限は「同じジム・同じアドレスで24時間3件」と「1つのジムで1時間20件」だけで、ジムを替えれば同じ人に
// 何通でも送れた・1つのジムから1日480通まで送れた。

export type GuestNameProblem = "empty" | "too_long" | "control" | "link";

export const GUEST_NAME_MAX = 100;

// 改行・タブなどの制御文字、行区切り、ゼロ幅・向きの制御（見た目を偽る）。絵文字の合成（U+200D）は通す
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
// URL・メールアドレス・ドメインらしいもの。全角は NFKC で半角にそろえてから見る（ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏｍ を通さない）
const LINK = /:\/\/|www\.|@|\b[a-z0-9-]+\.(?:com|net|org|jp|io|me|co|xyz|top|info|link|app|site|shop|online|club|biz|ly|gl|cc|ru|cn|page|dev|to)\b/i;

/** お名前として受け付けられないなら、その理由。受け付けられるなら null */
export function guestNameProblem(name: string): GuestNameProblem | null {
  if (!name) return "empty";
  if (name.length > GUEST_NAME_MAX) return "too_long";
  if (CONTROL.test(name)) return "control";
  if (LINK.test(name.normalize("NFKC"))) return "link";
  return null;
}

/** 同じメールアドレスの予約（＝確認メール）を、全部のジムを合わせて24時間に何件まで受けるか（キャンセル済みも数える） */
export const RATE_LIMIT_PER_CONTACT_ALL_TENANTS_24H = 5;
/** 1つのジムが24時間に受ける体験・ドロップインの件数の上限（1時間20件とは別。1つのジムから大量に送らせない） */
export const RATE_LIMIT_PER_TENANT_24H = 60;

// ---- 当日のサマリー（daily-trainer-summary）の文字数（2026-11-01 点検 daily-trainer-summary-1） ----
// send-push-notification は本文が500字を超えると断るので、体験予約のお名前（未ログインで100字まで入る）が長いと、
// そのジムの「本日の予定」が丸ごと届かなかった。

/** 1行に載せる名前は20字まで（絵文字を割らない） */
export function clipSummaryName(s: string): string {
  const chars = Array.from(s);
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}…` : s;
}

/** 通知の本文を500字以内にする。send-push-notification と同じ JavaScript の length（UTF-16）で数え、絵文字は割らない */
export function clipPushBody(s: string): string {
  if (s.length <= 500) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > 499) break;
    out += ch;
  }
  return `${out}…`;
}
