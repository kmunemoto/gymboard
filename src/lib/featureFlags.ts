export const STREAK_ENABLED = true;          // 連続来店記録（ストリーク）: ホームのストリークカード＋共有カードの週連続表示
export const MONTHLY_REPORT_ENABLED = true;  // 月次レポート画面: トレーナーのお客様詳細＋お客様ホームから開く導線

// ---------------------------------------------------------------------------
// お客様アプリの機能ON/OFF（業種特化の兄弟アプリ向け）
//
// GymBoard は「パーソナルジム全部盛り」なので、他業種（ストレッチ・鍼灸・エステ…）へ
// 複製したときに、その業種では意味を成さない機能が出っぱなしになる。
// 例えばストレッチ店で「種目×重量×回数」の記録タブや AI食事記録が出ていると、
// 誰も使わないタブが並ぶ「使えないアプリ」に見える。
//
// トレーナー側は tenants.show_nav_* / show_stat_* で店ごとに出し分けられるが、
// **お客様側には従来ON/OFFの仕組みが一切無かった**（show_* は全てトレーナー画面専用）。
// ここがその穴を埋めるフラグ群。
//
// 2026-08: 同じフラグをトレーナー側の顧客カルテ（TrainerClientDetail）と
// 月次レポート（CustomerMonthlyReport）にも効かせる。フォークでお客様側だけ
// 絞った結果、トレーナー画面が上流ジムボードのまま残るのを防ぐ。
//
// なぜ「店ごとの設定」ではなく「ビルド時の定数」なのか:
//   - 1リポジトリ＝1業種アプリ（Lovableが1プロジェクト1リポジトリのため）なので、
//     業種は製品ごとに固定。実行時に切り替える必要がない
//   - ビルド時定数なら Vite が false 側を丸ごと落とせる。特に姿勢分析は
//     TensorFlow.js（約580KB）を引くため、使わない業種で同梱しないのは大きい
//   - 既存の featureFlags.ts と同じ作法に揃えられる（第3の仕組みを作らない）
//
// 店ごとに出し分けたくなったら tenants に列を足し、`FLAG && tenant.show_xxx` の
// AND で合成すること。**下の層はOFFにできるだけで、OFFをONに戻せない**という規則にする。
//
// 兄弟アプリの作り方は mem/ops/vertical-fork.md を参照。
// ---------------------------------------------------------------------------

/** トレーニング記録タブ（種目×重量×回数・成長グラフ・体の変化写真）。筋トレ以外の業種では不要 */
export const WORKOUT_LOG_ENABLED = true;
/** AI食事記録タブ（写真からPFC解析）。減量が売りでない業種では不要 */
export const MEALS_ENABLED = true;
/** 姿勢分析（TensorFlow.js のポーズ推定）。施術系とは相性が良いが、推奨内容は筋トレ種目なので要差し替え */
export const POSTURE_ENABLED = true;
/** 部位別トレーニングバランスのレーダーチャート。部位マスタ（tenant_muscle_groups）は業種別化済み */
export const MUSCLE_RADAR_ENABLED = true;
/** 体重・体脂肪率の記録と表示。ボディメイク文脈でない業種では不要 */
export const BODY_METRICS_ENABLED = true;
/** トレーニング内容のSNSシェアカード */
export const WORKOUT_SHARE_ENABLED = true;
/**
 * 体験予約（公開の予約フォーム・確認/キャンセルページ・トレーナー側のリンク発行・
 * 案内文編集・体験フォロー管理タブ）。ジム特有の集客手法で、他業種では意味を成さない。
 *
 * false でも `trial_bookings` のデータ・Edge Function（trial-book / trial-cancel /
 * send-trial-reminders）・DBは一切削除しない。公開ページ（/trial, /trial/:tenantId,
 * /trial-cancel/:token）は経路自体は残るが「現在受け付けていません」の案内に切り替わり、
 * 予約RPCを一切呼ばなくなる。トレーナー側のリンクカード・案内文編集セクション・
 * 体験フォロー管理タブ（ナビ・ダッシュボードのバナー・設定の表示トグル行）も非表示になる。
 * 復活方法: この値を true に戻すだけ。
 */
export const TRIAL_BOOKING_ENABLED = true;

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

// ---------------------------------------------------------------------------
// 業種によって法令・広告規制の射程が変わる機能（2026-08）
//
// 下の3つは GymBoard（フィットネス文脈）では問題にならないが、医療隣接の
// 業種（接骨院・整骨院など）へ複製すると、同じ機能が別の法令の対象になりうる。
// vertical-fork.md の鉄則1「業種差分は値にする」に従い、コードを削るのではなく
// フラグで無効化できるようにしてある。**このコメントは法的助言ではない。**
// 実際に医療隣接業種へ出荷する際は、専門家の確認を挟むこと。
// ---------------------------------------------------------------------------

/**
 * 骨格タイプ診断（AIポーズ推定によるストレート/ウェーブ/ナチュラルの分類＋
 * タイプ別トレーニング推奨。SkeletalTypeCard と TrainingRecommendationCard の
 * タイプ別セクション）。
 *
 * GymBoard ではフィットネス文脈の体型分類（ファッション業界で言う「骨格診断」と
 * 同じ語）だが、医療隣接の業種で「診断」を名乗ると薬機法のSaMD
 * （Software as a Medical Device）判定に触れうる。
 *
 * false にしても、姿勢の見えている癖（猫背・ストレートネック・骨盤の傾き）に対する
 * ストレッチ提案（TrainingRecommendationCard の postureTips セクション。
 * feedbacks から算出され、タイプ分類には依存しない）は独立して残る。
 * 「タイプを診断する」部分だけを切り離せるよう、両セクションは疎結合にしてある。
 */
export const SKELETAL_DIAGNOSIS_ENABLED = true;

/**
 * Google口コミ依頼バナー（来店10回目のお客様に一度だけ表示。ジム設定の
 * 該当セクションで有効化する）。柔道整復師法24条は広告できる事項を限定しており、
 * 口コミ投稿の依頼が業種によっては広告規制に触れうる。
 * false にするとジム設定の該当セクションごと非表示になる。
 */
export const GOOGLE_REVIEW_ENABLED = true;

/**
 * 言語切替UI（設定画面の「Language」セクション）。
 * false にしてもロケールファイル自体は変更しない — `src/locales/*.json` を
 * 上流とバイト一致のまま保つのが merge 衝突を避ける生命線のため
 * （mem/ops/vertical-fork.md）。UIを隠すだけで、実質的に単一言語で出荷できる。
 */
export const LANGUAGE_SWITCHER_ENABLED = true;
