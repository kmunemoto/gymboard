# ダッシュボード統計カードの表示/非表示（ジムごと）

## 概要（2026-07〜）
トレーナーダッシュボード上部の4枚の統計カード（本日のセッション/アクティブ顧客/月間
セッション/今月売上）を、ジムごとに個別にON/OFFできる。

- `tenants.show_stat_today_sessions` / `show_stat_active_clients` /
  `show_stat_month_sessions` / `show_stat_month_revenue`（いずれも `boolean NOT NULL
  DEFAULT true`）。
- 設定画面: `TrainerGymSettings.tsx`「表示設定」セクション内、既存の「フォローが必要な
  顧客」トグルの下に4項目まとめてカードで表示。ラベルはダッシュボード側と同じ
  `dashboard.stat*` キーを再利用（新規i18nキーは作らず表記を一致させている）。
- `TrainerDashboard.tsx` の統計カードグリッドは表示ONの項目だけを描画する。**全て
  OFFにするとセクションごと非表示**になる（空のグリッドは出さない）。

## 実装メモ
- 4カラムとも `useTenant.ts` の `COL_VARIANTS` フォールバック（新カラム未適用環境向け）
  の最終段に追加。未適用環境では常に既定true（=全カード表示、従来どおり）にフォール
  バックする。
- 設定側は4トグル共通の1つの汎用ハンドラ（`handleToggleStatVisibility(column, checked)`）
  で更新している（ほぼ同型の処理を4つ書かない）。

## デプロイに関する注意
`supabase/migrations/20260721060000_add_dashboard_stat_visibility.sql` はLovable経由での
適用が必要。適用前は4カラムとも存在しないため、既定true（全カード表示、従来どおり）に
安全にフォールバックする。
