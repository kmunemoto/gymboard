// 体験予約・ドロップイン（未ログインの入力）の守り（2026-11-01・点検 trial-book-1 / trial-book-2 / drop-in-book-1）。
//
// お名前（guest_name）は、お客様宛ての確認メール・店宛てのメール・公式 LINE・Google カレンダー・当日のサマリーに
// そのまま入る。未ログインで誰でも入れられるので、URL・メールアドレス・改行を入れると、正規のドメイン・
// 公式アカウントから偽の案内（「こちらから手続きを」）を送れた・通知の行を偽れた。
//
// 確認メールは入力されたアドレスへ正規のドメインから届くので、回数の上限が「メールの中継」の上限になる。
// 今までの上限は「同じジム・同じアドレスで24時間3件」と「1つのジムで1時間20件」だけで、ジムを替えれば同じ人に
// 何通でも送れた・1つのジムから1日480通まで送れた。
//
// 2026-11-10（定期点検 trial-book-2・trial-book-cap-1・guest-name-1）:
// - 上限は trial_bookings の行ではなく、店が消せない記録（email_send_quota。../_shared/emailQuota.ts）で数える。
//   行で数えていたので、オーナーが自分のジムの行を消す・作成日時を書き換えるだけで数え直させられた。
//   宛先は小文字・+タグ・Gmail の点をそろえてから数える（大文字や +1 を足すだけで別の宛先になっていた）
// - お名前のドメインは、よくある TLD の一覧ではなく、TLD 全体（./tlds.ts）と形で見る（.tokyo・.ai・lin.ee・
//   forms.gle・IP アドレスが通っていた）

import { TOP_LEVEL_DOMAINS } from "./tlds.ts";

export type GuestNameProblem = "empty" | "too_long" | "control" | "link";

export const GUEST_NAME_MAX = 100;

// 改行・タブなどの制御文字、行区切り、ゼロ幅・向きの制御（見た目を偽る）。絵文字の合成（U+200D）は通す
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
// URL・メールアドレスの印。全角は NFKC で半角にそろえてから見る（ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏｍ を通さない）
const LINK_MARK = /:\/\/|www\.|@/i;
// IPv4 アドレス（203.0.113.5 など）
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\d)/;
// 点でつながった語（ドメインの候補）。英数字のほか、日本語などの国際化ドメインの文字も含める
const DOTTED = /(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// ドメインの直後に続くと「リンクの続き」になる文字（パス・問い合わせ・ポート）
const PATH_AFTER = /^[/?#:]/;
// ブラウザがドメインの区切りとして読む「。」（U+3002。半角の U+FF61 は NFKC でこれになる）。日本語の文の中の
// 「。」もこれなので、点としてそろえるのはドメインを探すときだけ
const IDEOGRAPHIC_FULL_STOP = /\u3002/g;

// 名前の頭に付く敬称（"Mr.Kim"・"Dr.Who" の kim・who は TLD なので、頭文字と同じ扱いにする）
const HONORIFICS = new Set(["mr", "ms", "mrs", "dr", "mx", "jr", "sr", "prof", "miss"]);
const nameLikeLabel = (label: string) => Array.from(label).length === 1 || HONORIFICS.has(label);

/**
 * 文字の中に、リンクとして働くドメインがあるか（2026-11-10・点検 guest-name-1）。
 *
 * 一覧（.com・.jp など25個）で見ていたので、.tokyo・.ai・.store・lin.ee・forms.gle・youtu.be は通っていた。
 * いまは TLD 全体（./tlds.ts）と照らす。ただし名前の書き方で誤って断らないように:
 * - 点の後ろが TLD でなければドメインではない（"Ana.Maria"・"K.Munemoto"・"T.Yamada"）
 * - 頭文字・敬称＋点＋TLD（"J.Kim"・"Y.Ren"・"Mr.Kim"。kim・ren は TLD）は名前の書き方と区別できないので、
 *   すぐ後ろに / ? # : が続く（＝リンクの続きがある）ときだけ断る（"t.co/abc" は断る）。
 *   ⚠️ 残り: 1文字のドメインそのもの（パス無し）は通る。1文字のドメインは取るのが難しく、パスが無いと
 *   トップページにしか飛ばない（tenant-boundary.md の穴34）
 */
function hasDomain(normalized: string): boolean {
  const s = normalized.replace(IDEOGRAPHIC_FULL_STOP, ".");
  for (const m of s.matchAll(DOTTED)) {
    const labels = m[0].split(".");
    const tld = labels[labels.length - 1];
    if (!TOP_LEVEL_DOMAINS.has(tld) && !tld.startsWith("xn--")) continue;
    if (labels.slice(0, -1).some((l) => !nameLikeLabel(l))) return true;
    if (PATH_AFTER.test(s.slice((m.index ?? 0) + m[0].length))) return true;
  }
  return false;
}

/** お名前として受け付けられないなら、その理由。受け付けられるなら null */
export function guestNameProblem(name: string): GuestNameProblem | null {
  if (!name) return "empty";
  if (name.length > GUEST_NAME_MAX) return "too_long";
  if (CONTROL.test(name)) return "control";
  const normalized = name.normalize("NFKC").toLowerCase();
  if (LINK_MARK.test(normalized) || IPV4.test(normalized) || hasDomain(normalized)) return "link";
  return null;
}

/** 同じメールアドレスの予約（＝確認メール）を、全部のジムを合わせて24時間に何件まで受けるか（キャンセル済みも数える） */
export const RATE_LIMIT_PER_CONTACT_ALL_TENANTS_24H = 5;
/** 1つのジムが24時間に受ける体験・ドロップインの件数の上限（1時間20件とは別。1つのジムから大量に送らせない） */
export const RATE_LIMIT_PER_TENANT_24H = 60;
/** 1つのジムが1時間に受ける体験・ドロップインの件数の上限（宛先を替えて上の2つを避けるのへの備え） */
export const RATE_LIMIT_PER_TENANT_1H = 20;

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
