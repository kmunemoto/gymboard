# 2026-07-21 本番障害: トレーナーのホームタブが「画面の読み込みに失敗しました」

## 症状
- トレーナー側ホームタブ（TrainerDashboard）だけが LazyBoundary のエラー表示に落ちる。
- 他のタブは全て正常。リロード・プライベートウィンドウ・Androidアプリ（ローカル埋め込みビルド）でも再現
  ＝キャッシュ/Service Worker/チャンク404は無関係。全テナントで発生（新規の空テナントでも100%再現）。

## 根本原因
`useAllBookings` のリアルタイム購読がチャンネル名固定（`trainer-all-bookings-realtime`）だった。
`supabase.channel(name)` は**同名チャンネルが既にあると既存インスタンスを返す**ため、
ホームタブで `useAllBookings` が2つ同時にマウントされると（TrainerDashboard 本体＋
稼働率ヒートマップ TrainerUtilizationHeatmap）、2つ目のフックの `.on("postgres_changes", ...)` が
「購読済み（joined/joining）チャンネルへの callbacks 追加」となり、supabase-js が

```
Error: cannot add `postgres_changes` callbacks for realtime:trainer-all-bookings-realtime after `subscribe()`.
```

を **throw**（realtime-js `RealtimeChannel.on()` 内）。useEffect 内の例外は ErrorBoundary に伝播するため、
LazyBoundary が捕捉して画面全体がエラー表示になった。

- 購読自体は PR #124（同日キャンセルの予定表反映）で追加。単独マウントの間は無害だった。
- 稼働率ヒートマップ（同じ画面に2個目の `useAllBookings`）のリリースで発症。
  同時期にリリースした統計カードON/OFF（PR #168）が疑われ緊急revert（PR #169）したが、これは無関係だった。

## 調査で時間を失った点（教訓）
- ローカル/サンドボックスの Playwright では再現しなかった: サンドボックスは Supabase への
  WebSocket が繋がらず、チャンネルが joined にならないため `.on()` が throw しない。
  **リアルタイム購読のバグは本番相当のWS接続がある環境でしか発火しない。**
- 「設定タブは正常・ホームだけ壊れる・リロード無効」はチャンク404と酷似するが、
  今回は純粋なランタイム例外だった。LazyBoundary は両方を同じ文言で表示するため区別できない。
  区別には実ブラウザの `[LazyBoundary] chunk/render error:` のスタックトレースが必須。
- GitHub への merge だけでは本番Webは更新されない（Lovable の Publish が別途必要）。

## 修正
チャンネル名を購読ごとに一意化（`-${Math.random().toString(36).slice(2)}` を付加）。
これで各フックインスタンスが独立したチャンネルを持ち、共有インスタンス化が構造的に起きない。
`useMyBookings`（顧客側の同型フック、`user.id` のみでは同一ユーザー2画面同時マウントで衝突）にも同じ対策を適用。

## 同一クラスの潜在パターンも全て予防修正済み（フォローアップ）
`useAllBookings` の直接原因を直した後、同じ「固定名チャンネル」を作る箇所を全て洗い出し、
`src/lib/realtimeChannel.ts` の `uniqueChannelName()` ヘルパーで一律に一意化した:
- `src/hooks/useProfile.ts` の `customer-list-realtime`（useAllCustomerProfiles。4つのトレーナー
  タブで使われ、タブ切替時に旧購読の unsubscribe〈非同期〉完了前に同名再購読でthrowする恐れがあった）
- `src/hooks/useMessages.ts` の `unread-global` / `unread-by-sender` / `messages-${otherUserId}`
- `src/hooks/useBookings.ts` の `my-bookings-realtime`（顧客側）
- `src/components/trainer/TrainerView.tsx` の `trainer-msg-toast`（ログアウト→ログインの再マウント競合予防）

**ルール: Realtime チャンネル名は必ず `uniqueChannelName()` で一意化する。固定名を直接
`supabase.channel()` に渡さない。** 固定名のフック/コンポーネントを複数マウントすると2つ目で即クラッシュする。

補足（supabase-js の挙動、v2.108.2 で確認）:
- `supabase.channel(name)` は同名があると既存インスタンスを返す（新規作成しない）。
- `removeChannel()` は `async`。`await channel.unsubscribe()`（ネットワーク往復）が解決するまで
  クライアントの `channels` 配列から外れない。よって固定名だと「アンマウント直後の再マウント」で
  旧チャンネルがまだ配列に残り、`joined` 状態のまま `.on()` を呼んで throw する競合が起きうる。
