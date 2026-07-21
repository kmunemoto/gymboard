## 調査結果

### やったこと
- Playwright でアプリ（localhost / preview / 公開URL app.kyoto-salute.com）を開こうとしましたが、この環境には Supabase セッションが注入されていない状態（`LOVABLE_BROWSER_AUTH_STATUS=signed_out`）で、トレーナーとしてログインしてホームタブを再現することができませんでした。ブラウザのコンソールログ・ネットワークログもスナップショットに残っていません（`code--read_console_logs` / `code--read_network_requests` / `code--read_session_replay` すべて空）。
- 「PostgREST の schema cache に新カラムが載っていない」説を潰すため、anon キーで `tenants.show_stat_*`, `google_review_url`, `daily_summary_enabled`, `booking_buffer_minutes`, `show_retention_alerts`, `line_url`, `trial_info_title`, `same_day_cancel_penalty_enabled`, `trial_bookings.follow_up_status`, `bookings.trainer_note`, `profiles.review_prompted_at` をそれぞれ `select=<col>&limit=0` で叩きました。**全カラムでエラーは返らず**（レスポンスは `[]`、`PGRST204 "column not found"` のような JSON エラーではない）、カラムは PostgREST に認識されています。
- `npx tsgo --noEmit` を実行しました。**型エラーなし**。
- 最近マージされた PR #168（`show_stat_*`）・#166（口コミ）・#164（ヒートマップ）・#163（セッションメモ）・#161（体験CRM）関連のコード（`TrainerDashboard.tsx`, `TrainerUtilizationHeatmap.tsx`, `useTenant.ts`, `useProfile.ts`, `useBookings.ts`, `useCounselingResponses.ts`, `LazyBoundary.tsx`, `i18n.ts`）を読みました。読める範囲では、null/undefined 参照や不整合な API 呼び出しは見つけられませんでした。
- LazyBoundary の挙動を確認：この「画面の読み込みに失敗しました」は `componentDidCatch` が発火した後の表示です。つまり **`TrainerDashboard` の遅延読込ではなく、レンダリング中の例外が投げられている** ことがほぼ確実です（`console.error("[LazyBoundary] chunk/render error:", error)` が出力されるはず）。

### 判明した重要事実
- DB スキーマ・PostgREST 側は正常。適用漏れではありません。
- LazyBoundary が catch する「render / lifecycle 中の同期例外」または「Suspense chunk の import 失敗」のいずれか。この2択の区別が、ユーザー側の実際のコンソールログ（特に `[LazyBoundary] chunk/render error:` の後段のスタックトレース）でしか付けられません。

### 推定は現時点では確定できません
コンソールの実エラーが取れていないため、どの hook / どのコンポーネントで落ちているかは断定できません。「TrainerDashboard か TrainerUtilizationHeatmap のどちらか、あるいはそこから呼ばれる hook」というところまでしか絞れていません。

## 次のアクション

**ユーザーに以下のいずれかをお願いする必要があります**（コードは触りません）：

1. **推奨・最短ルート**: ブラウザで対象画面を開き、DevTools の **Console** タブに出ている以下を丸ごとコピーして貼り付ける
   - `[LazyBoundary] chunk/render error:` で始まる行と、その直後のスタックトレース
   - もしあれば、その直前・直後の赤い Uncaught / TypeError / SyntaxError / ChunkLoadError
   - **Network** タブで赤くなっている `supabase.co/rest/v1/…` の URL とレスポンスボディ

2. または、こちらでプロキシ経由で service_role 権限のトレーナーとしてセッションを注入して再現できるように、Lovable preview 上でトレーナーとして手動ログイン → チャットに戻ってくる（次ターンで `LOVABLE_BROWSER_AUTH_STATUS=injected` になれば Playwright で再現できます）。

いずれかが得られた時点で、原因コンポーネント・行番号を特定し、修正案（コード変更）を別途ご提案します。それまではコード変更は行いません。
