export const STREAK_ENABLED = true;          // 連続来店記録（ストリーク）: ホームのストリークカード＋共有カードの週連続表示
export const MONTHLY_REPORT_ENABLED = true;  // 月次レポート画面: トレーナーのお客様詳細から月次レポートを開く導線

// 外部連携の有効/無効フラグ。
// App Store / Google OAuth 審査の都合で一時的に非表示にしているセクションを
// ここで一元管理する。外部設定が整い次第、対象フラグを true に戻すだけで再有効化できる。
// 連携済みユーザーのデータ・通知ロジックには影響しない。

// LINE（Messaging API）連携。false でLINEへのプッシュ送信を全面的に停止する。
//   - お客様/トレーナー設定の「LINE連携」セクションを非表示
//   - 予約確定・キャンセル・予約変更・メッセージ・連続来店の各通知を送らない
//     （送信は src/lib/lineNotify.ts の sendLineMessage() 一箇所に集約済み）
//
// なぜ止めるか（2026-07）:
//   LINE Messaging API のトークン LINE_CHANNEL_ACCESS_TOKEN は**全テナント共有の1本**しか
//   無く、ジムごとに公式アカウントを持たせる仕組みが無い。そのため
//     - 他ジムのお客様に、こちらのLINEアカウントから通知が飛ぶ形になる
//     - line-booking-reminder は事故防止のため特定テナントに限定されており、
//       他ジムには前日リマインドが一切届かない（あるのに動かない機能）
//   マルチテナントSaaSとして配る以上、中途半端に残すより一旦外す判断。
//
// ※ ジム設定の「LINEで連絡」ボタン（tenants.line_url）は**別物なので残している**。
//    各ジムが自分のLINE URLを入れて、お客様に開いてもらうだけのリンクで、
//    Messaging API もトークンも使わない。マルチテナントでも問題なく動く。
//
// ※ サーバー側の前日リマインド（line-booking-reminder / pg_cron）は、このフラグでは
//    止まらない。cron ジョブ自体を無効化すること（mem/features/line-integration-disabled.md）。
//
// 復活方法: この値を true に戻すだけ。コードも profiles.line_user_id 等のデータも
// 一切削除していない。ただし本来は、ジムごとにチャネルアクセストークンを持てるように
// してから戻すこと。
export const LINE_INTEGRATION_ENABLED = false;
// Googleカレンダー連携の表示フラグ。Salute プロジェクトの OAuth クライアントを流用。
//  - ジム（トレーナー）設定: 自分の Google アカウントを連携する用途。
//  - お客様向け: 全テナントで表示。OAuth 同意画面は審査通過済みのため、一般のお客様も
//    警告なしで連携できる（calendar.events は機密スコープ）。
export const GOOGLE_CALENDAR_TRAINER_ENABLED = true;  // ジム（トレーナー）設定の連携セクション
export const GOOGLE_CALENDAR_CUSTOMER_ENABLED = true; // お客様設定の連携セクション（全テナントで表示）
export const APPLE_CONNECTION_ENABLED = false; // Apple連携セクション（App Store審査中）

// キャンセル待ち（満枠スロットへの登録）。
// ON: 満枠スロットをタップするとキャンセル待ち登録/解除の確認ダイアログが開き、
// キャンセルで枠が空くとその枠の待機者へプッシュ通知が届く（send-push-notification の
// waitlist_slot_freed。受信者解決・文言生成はサーバー側）。
// 予約成立時は自分の該当待機を自動解除する。
// 前提: DBマイグレーション booking_waitlist（20260624120000）と
// send-push-notification の再デプロイが適用済みであること。
// 以前は満枠グリッドのラベルが常に「キャンセル待ち」に変わり、満枠だらけで見づらいという
// 理由でOFFにしていた。2026-07、グリッドの見た目は通常の「満枠」表示のまま（登録済みは
// 隅の小さいドットのみ）にし、タップ時だけ確認ダイアログを出す方式に直したため再度ON。
export const WAITLIST_ENABLED = true;

// ソーシャルログイン（Appleでサインイン / Googleでログイン）のボタン表示。
// 既定 OFF。Supabase の Authentication → Providers で Apple / Google を
// 有効化し OAuth 認証情報（クライアントID/シークレット・リダイレクトURL等）を
// 設定するまでは、ボタンを押すと Supabase が
// "Unsupported provider: provider is not enabled" を返し、生のエラー画面へ
// 遷移してしまう（Web では SDK が認可URLへ遷移するためコード側で抑止できない）。
// プロバイダー設定が完了したら true に戻すだけでログイン画面に再表示される。
export const SOCIAL_LOGIN_ENABLED = false;

// ジムボードの課金システム（GymBoard SaaS の料金・トライアル・席数上限・延滞ブロック）。
// false にすると課金まわりを一括で無効化し、ジムは無料・無制限で利用できる。
//   - 課金UI（設定の「プラン・お支払い」= TrainerBilling）を非表示
//   - 席数超過/延滞の警告バナー（PlanLimitBanner / SubscriptionBlockedBanner）を非表示
//   - クライアントの延滞判定 isTenantSubscriptionBlocked を常に false に
// ※ サーバー側の実強制（DBトリガー enforce_tenant_plan_limit）は別マイグレーション
//    （supabase/migrations/..._disable_billing_enforcement.sql）で無効化する。
// 復活方法: この値を true に戻し、上記マイグレーションを差し戻すだけ。
// コードは一切削除しないため、課金機能はそのまま温存される。
export const BILLING_ENABLED = true;

// ゲーミフィケーション（アバター・EXP/レベル・称号・バッジ・ミッション・
// レイドボス・シーズンイベント）。
// false にすると、これらがアプリ上から一切出なくなる:
//   - トレーニング記録の保存後に出ていた獲得系の演出をすべて停止
//     （ミッション達成トースト / セッションEXPダイアログ / マイルストーン獲得ダイアログ /
//       レイド撃破トースト / シーズンイベント達成トースト）
//   - SNSシェアカードの獲得バッジ表示
// 「パーソナルジムの管理ツール」として機能を絞る方針のため既定OFF（2026-07）。
//
// BILLING_ENABLED と同じ方針で、コードもDBのデータ（獲得済みバッジ・EXP等）も
// 一切削除していない。true に戻すだけで元どおり復活する。
// ※ workouts の AFTER INSERT トリガー（ガチャ券付与・クエストダメージ）はDB側の処理のため
//    このフラグでは止まらない。ただし対応するUIが無いので利用者からは見えない。
//    完全に消す場合はトリガー削除のマイグレーションが別途必要。
// ※ 「目標」(profiles.milestone_goal / MilestoneGoal) はトレーナーが設定する
//    コーチング用のテキストで、ゲーム要素ではない。このフラグの対象外。
export const GAMIFICATION_ENABLED = false;
