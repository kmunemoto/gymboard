// Supabase Realtime のチャンネル名を「購読インスタンスごとに一意」にするための小さなヘルパー。
//
// なぜ必要か:
//   supabase.channel(name) は同名のチャンネルが既にあると既存インスタンスを返す。
//   そのため固定名のチャンネルを作るフックが、同一画面に2つ同時マウントされたり
//   （例: ホームタブの TrainerDashboard 本体＋稼働率ヒートマップが両方 useAllBookings を使う）、
//   タブ切替時に旧インスタンスの unsubscribe（非同期）が終わる前に同名で再購読したりすると、
//   2つ目の .on("postgres_changes", ...) が「購読済みチャンネルへの callbacks 追加」となり
//   "cannot add `postgres_changes` callbacks ... after `subscribe()`" を throw、
//   その例外が ErrorBoundary(LazyBoundary) に捕捉されて画面全体が壊れる（2026-07 本番障害）。
//   詳細: mem/incidents/2026-07-21-home-tab-crash.md
//
// ルール:
//   フック/コンポーネント内で作る Realtime チャンネル名は、必ずこの関数で一意化する。
//   固定名を直接 supabase.channel() に渡さないこと。
export const uniqueChannelName = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2)}`;
