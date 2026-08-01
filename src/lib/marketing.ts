// GymBoard の集客導線（グロース）で使う定数。
// お客様がSNSへ投稿するトレーニングのシェア画像や、体験予約の公開ページに
// 控えめな「Powered by GymBoard」を出し、見た人（＝他ジムのオーナー・トレーナー含む）に
// プロダクトを知ってもらう入口にする。
//
// 実際の値（LPのURL・ブランド表記・運営者の問い合わせ先）は src/lib/brand.ts に集約した。
// 兄弟アプリ（業種特化版）は brand.ts だけ差し替えれば済むようにするため
// （mem/ops/vertical-fork.md）。ここは「グロース施策としての意味づけ」と
// 表示ON/OFFだけを持つ。

import { MARKETING_SITE_URL, POWERED_BY_LABEL, SUPPORT_EMAIL } from "@/lib/brand";

/** マーケティングサイト（LP）のURL */
export const GYMBOARD_MARKETING_URL = MARKETING_SITE_URL;

/** SNSシェア画像・公開ページに出すブランド表記（固有名詞のため多言語化しない） */
export const POWERED_BY_GYMBOARD = POWERED_BY_LABEL;

/**
 * サービス提供者へのお問い合わせ先メールアドレス。
 * プライバシーポリシー・特定商取引法に基づく表記・アカウント削除案内で使う、
 * 「ジムではなくサービス運営者」への連絡先。
 *
 * 注意: これは各ジムの連絡先（tenants.email）とは別物。お客様がジムに連絡する導線には
 * 必ず tenants.email を使うこと（体験予約の確認メール等）。
 */
export const GYMBOARD_SUPPORT_EMAIL = SUPPORT_EMAIL;

// 「Powered by GymBoard」導線の表示ON/OFF（全テナント共通のグロース施策）。
// 自社利用だけで外部露出を止めたい場合は false にする。
export const POWERED_BY_GYMBOARD_ENABLED = true;
