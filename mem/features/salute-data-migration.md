# Salute → GymBoard データ移行・同期の全体像

対象テナント: Salute御所南 (`tenant_id = ceda19b0-d5e0-4928-ab2e-996a0b823af4`)
Salute (旧アプリ) プロジェクト: `gvgrqaigffxtkvckjfur` / GymBoard: `rrbfwitprzuevzytykrq`

## アーキテクチャ

- GymBoard 側の `migrate-*` / `reconcile-*` 関数が、Salute 側にデプロイ済みの
  `salute-export-*` エンドポイントを **`x-migration-secret` ヘッダー**
  (`MIGRATION_SHARED_SECRET`、両プロジェクトに同値を設定) で呼び出す。
- **注意: `salute-export-*` のソースコードは kyoto-salute リポジトリに存在しない**
  (Lovable チャットで直接作成されデプロイのみ)。コードを見るには Supabase 側から
  取得する必要がある。契約(下記)は GymBoard 側の呼び出しコードから復元したもの。
- ユーザー対応表: `migration_user_map` (tenant_id, salute_user_id → gymboard_user_id, email)。
  `migrate-customers` だけが書き込む。
- 種目対応表: `exercise_id_map` (salute_exercise_id → gymboard_exercise_id)。
  `prepare-import` だけが書き込む。

## Salute 側エンドポイント (デプロイのみ、GET + x-migration-secret)

| エンドポイント | パラメータ | レスポンス |
|---|---|---|
| salute-export-counts | なし | 件数サマリー |
| salute-export-customers | ?limit=N (≤500) | { customers: [{ user_id, email, profile, bookings[], workouts[] }] } — workouts は { salute_exercise_id, workout_date, weight, reps, sets, notes, created_at } |
| salute-export-exercises | なし | { exercises: [...] } 種目マスター全件 |
| salute-export-measurements | なし (全件) | { measurements: [{ user_id, measured_date, weight, body_fat, created_at }] } |
| salute-export-goals | なし | { goals: [{ user_id, training_goal }] } |
| salute-export-bookings | ?from=YYYY-MM-DD | { bookings: [...] } |
| salute-export-blocked-slots | なし | { blocked_slots: [...] } |

## GymBoard 側関数と実行順序

1. **prepare-import** — tenant_plans 種まき + 種目マスター取り込み + exercise_id_map 構築 (冪等)
2. **migrate-customers** — 未移行客の auth/profiles/tenant_members 作成 + 初回のみ bookings/workouts 一括投入 + migration_user_map 登録。**移行済みユーザーは丸ごとスキップ**するため、後から増えたデータは拾わない
3. **migrate-measurements** — user_measurements 全件 UPSERT (onConflict user_id,measured_date)。冪等だが全期間を Salute 値で上書きする
4. **migrate-goals** — profiles.training_goal 更新
5. **migrate-period-data** — 指定期間の体重・体脂肪率・トレーニング記録の追いつき取り込み (下記)
6. **repair-partial-migration** — bookings/workouts の部分欠損修復 (workouts は件数比較→全削除+再投入なので注意)

リアルタイム系: gymboard-sync-booking / gymboard-sync-goal / gymboard-sync-trial-booking (Salute→GymBoard push)、
sync-bookings-to-salute (毎時)、sync-trial-cancel-to-salute (即時)、reconcile-bookings-from-salute。

## migrate-period-data (期間データの追いつき取り込み)

初回移行後も Salute アプリで記録が続いた期間 (例: 2026年6月) を後から反映するための関数。
Salute 側の追加デプロイ不要 (export-customers / export-measurements を再利用)。

- Body (POST のみ): `{ from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", dry_run?: boolean, max_days?: number }`
  (デフォルト from=2026-06-01, to=JST今日, **dry_run=true** — 本実行は `{"dry_run": false}` を明示)
- 認可: `authorizeAdmin` (service_role Bearer または x-migration-secret)。anon キーだけでは実行不可
- 体測定: 期間内のみマージ UPSERT (Salute 非NULL優先、既存値を NULL で消さない、同値スキップ、
  別テナント所属行はスキップ報告)
- workouts: **日単位置き換え** — Salute に記録がある (user, workout_date) のみ、内容の
  マルチセット比較で差分がある日だけ「新行を挿入→成功後に旧行を id 指定で削除」。
  Salute に無い日 (GymBoard 直接入力) は不変。未マッピング種目を含む日はスキップして報告
- 既存行の読み込みは .range() でページングする (PostgREST max-rows=1000 の無言切り捨て対策)
- 先に migrate-customers / prepare-import が必要なケースは response の hints に出る

## 落とし穴 (ハマりどころ)

- `workouts` には一意制約が無い (1行=1種目/日、セット詳細は sets jsonb)。重複防止は
  アプリ側ロジックのみ。日付列は JST カレンダー日付の `date` 型 (created_at で期間判定しない)
- workouts の AFTER INSERT トリガー: ガチャ券付与 (user+date で冪等) とクエストダメージ
  (発火する。取り込み分だけ加算される)
- BEFORE INSERT の `enforce_tenant_plan_limit` がプラン上限超過時に例外を投げる
  (migrate-period-data は事前チェックあり)
- tenant_id 未設定の行は RESTRICTIVE RLS で全ユーザーから不可視になる。移行系の
  INSERT は必ず tenant_id を入れる
- exercises の一意制約は 20260614 以降 (tenant_id, name)。名前照合はテナント内に限定すること
- Lovable 連携: GitHub マージだけでは Edge Function がデプロイされないことがある。
  新規・変更した関数は Lovable 側でデプロイを依頼する
