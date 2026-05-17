# ログインボーナス + シーズンパスシステム実装計画

## Phase 1: データベース（マイグレーション）

### Part 1: ログインボーナス
- `daily_login_bonuses` テーブル作成（user_id, login_date, day_number, reward_type, reward_amount, claimed_at）
- RLS: 自分のみSELECT/INSERT、トレーナーは全件閲覧
- RPC `claim_daily_login_bonus(p_user_id)`：JST今日判定、昨日連続チェック、Day 1〜7サイクル、報酬付与（coins/exp/gacha_ticket）。プレミアムなら +5コイン上乗せ
- RPC `get_login_bonus_status(p_user_id)`：今日取得済みフラグ、現在連続日数、7日カレンダー進捗、次の報酬

### Part 2: シーズンパス
- `season_pass_config`（month UNIQUE, name, start/end_date, premium_cost_coins, premium_exp_multiplier, premium_daily_coins）
- `season_pass_levels`（config_id, level, required_points, free_/premium_ reward_type/key/amount）
- `user_season_pass`（user_id, config_id, is_premium, current_points, current_level）
- `user_season_pass_claims`（user_id, config_id, level, track）
- RLS：ユーザーは自分のみ、masterテーブルは全認証ユーザーがSELECT、トレーナーが書込
- RPC `add_season_pass_points(p_user_id, p_points, p_action)`：当月config取得、user_season_pass UPSERT、レベル再計算
- RPC `claim_season_pass_reward(p_user_id, p_level, p_track)`：プレミアム判定、重複チェック、報酬付与
- RPC `purchase_premium_pass(p_user_id)`：コイン消費、is_premium = true
- 初期データ：5月パスconfig + 30レベル分

### 既存処理への組み込み
- `claim_daily_login_bonus` 内末尾に `add_season_pass_points(..., 10, 'login_bonus')`
- 既存のセッション保存・ミッション達成・ライバルバトル・クエストバトルRPCに同様に追加（既存RPC調査の上）
- avatar_exp_logs INSERT時にプレミアム1.5倍：トリガーで実装（is_premium判定）

## Phase 2: フロントエンド（フック）

- `src/hooks/useLoginBonus.ts`：status取得、claim実行、未取得判定
- `src/hooks/useSeasonPass.ts`：当月パス、レベル一覧、claim/purchase

## Phase 3: フロントエンド（UI）

### ログインボーナス
- `src/components/customer/LoginBonusDialog.tsx`：7日カレンダー、Day 7特別デザイン、受取ボタン、報酬演出
- `CustomerHome` または `CustomerView` に自動表示ロジック（0.5秒遅延、未取得のみ）
- `CustomerHome` 上部にバナー（未取得時のみ）

### シーズンパス
- `src/pages/SeasonPass.tsx` 新規ページ + `App.tsx` にルート `/season-pass` 追加
- ヘッダー（パス名、残り日数、ポイントバー、プレミアム購入ボタン）
- 30レベル縦スクロール、無料/プレミアム2トラック横並び
- 受取ボタン、ロック、チェック表示
- `CustomerHome` にシーズンパスカード（未受取で赤ドット）

## Phase 4: 検証

- ビルド確認、コンソールログ確認

## 技術メモ

- JST：`get_jst_today()` SQL関数 or `(now() AT TIME ZONE 'Asia/Tokyo')::date`
- 既存RPC名は調査が必要（execute_quest_battle, enter_rival_battle, evaluate_daily_missions等）
- マイグレーションは1ファイルにまとめて承認 → コード実装
