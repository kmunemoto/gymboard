// GymBoard の集客導線（グロース）で使う定数。
// お客様がSNSへ投稿するトレーニングのシェア画像や、体験予約の公開ページに
// 控えめな「Powered by GymBoard」を出し、見た人（＝他ジムのオーナー・トレーナー含む）に
// プロダクトを知ってもらう入口にする。
//
// マーケティングサイト（LP）のURL。最終的な独自ドメインが決まったらここだけ変える。
export const GYMBOARD_MARKETING_URL = "https://gymboard-app.lovable.app";

// SNSシェア画像・公開ページに出すブランド表記（固有名詞のため多言語化しない）。
export const POWERED_BY_GYMBOARD = "Powered by GymBoard";

// GymBoard（サービス提供者）へのお問い合わせ先メールアドレス。
// プライバシーポリシー・特定商取引法に基づく表記・アカウント削除案内で使う、
// 「ジムではなくサービス運営者」への連絡先。
//
// 注意: これは各ジムの連絡先（tenants.email）とは別物。お客様がジムに連絡する導線には
// 必ず tenants.email を使うこと（体験予約の確認メール等）。
//
// 現在の値は運営者（宗本寛太 / KantaAppLab）の実アドレス。ドメインがジム側の
// kyoto-salute.com になっているのはSaaSとしては不自然なので、サービス用ドメインの
// アドレス（例: support@gymboard.app）を用意したらここ1箇所を書き換えれば全ページに反映される。
export const GYMBOARD_SUPPORT_EMAIL = "k.munemoto@kyoto-salute.com";

// 「Powered by GymBoard」導線の表示ON/OFF（全テナント共通のグロース施策）。
// 自社利用だけで外部露出を止めたい場合は false にする。
export const POWERED_BY_GYMBOARD_ENABLED = true;
