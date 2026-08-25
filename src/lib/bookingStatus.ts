// 予約の status に入る文字列のうち、判定に使うもの。
//
// 🔴 lib に置くのは、**lib が hooks に依存しないため**。
//    もともと `useBookings.ts` にあり、`messageQuote.ts` / `missionRewards.ts` が
//    そこから import していた。向きが逆だと、lib を型検査するだけで
//    hooks とコンポーネントの木が丸ごと引きずり込まれる（tsconfig.strict.json）。

// 同日キャンセルを「消化扱い」にしたときの status。物理削除の代わりにこの値へ
// UPDATE することで、既存の「status === 'キャンセル済み' を除外する」判定
// （courseProgress.ts / planUsage.ts の消化数カウント、リマインダー系Edge
// Functionの `status === '予約済み'` 厳密一致、カレンダー系の `!== 'キャンセル済み'`
// 表示）が無改修のまま意図通りに動く: 消化数には数えられ、来ないはずのリマインドは
// 飛ばず、トレーナーの予定表には枠として残る。詳細は mem/features/booking-cancellation.md 参照。
export const SAME_DAY_FORFEIT_STATUS = "同日キャンセル済み";
