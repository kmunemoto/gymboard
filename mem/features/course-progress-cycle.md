# 回数の数え方（サイクル窓と「実効サイクル」）

## 概要
「今回の何回目か」を出すロジックは `src/lib/courseProgress.ts` に集約。
表示先は2系統ある。

| 表示 | 入口 | ファイル |
|---|---|---|
| 予約チップの「2/4」 | `getBookingProgressIndex` | `TrainerSchedule` / `WeekTimelineView` / `TrainerDashboard` / `CustomerBooking` |
| プロフィールの「予約済み 2/4・利用期間 7/28〜8/29」 | `computePlanUsage` | `PlanUsageCard`（`src/lib/planUsage.ts`） |

**この2つは必ず同じ窓で数えること。** 別々の窓を使っていたのが下記の不具合。

## 暦窓（getCycleWindow）と実効サイクル（resolveEffectiveCycle）
- `getCycleWindow` は起算日の**応当日ベースの暦窓**。起算日 6/30・1ヶ月なら
  `[6/30, 7/31)` `[7/31, 8/31)` …（応当日 7/30 は前サイクルの最終日）。
- `resolveEffectiveCycle` はそこに**ジムの運用**を重ねたもの。
  「回数を使い切ったら、期限の終わりを待たずに次のルーティンが始まる」ため、
  窓内の有効予約が上限を超えたら (上限+1)回目の予約日を新しい起算日にして窓を引き直す。
  猶予（graceDays）で前サイクルへ繰り入れた分（`lent`）は今サイクルの消化に数えない。
  ロールするのは**新ルーティンの1回目の日が実際に来てから**（未来の予約では窓を動かさない）。

## 2026-07: 応当日をまたぐとチップの回数が1に戻る不具合
起算日 6/30・月4回・猶予OFFのお客様で、8/7 の予約チップが **1/4**（正しくは 2/4）と表示された。
プロフィール側は「予約済み 2/4・利用期間 7/28〜8/29」と正しく出ており、画面間で食い違っていた。

実データ: 6/30, 7/8, 7/13, 7/21, **7/28**, 8/7。

原因は `getBookingProgressIndex` だけが**暦窓**で数えていたこと。
暦窓 `[6/30, 7/31)` には5件入るので、5件目の 7/28 は
「`((5-1) % 4) + 1 = 1`」という剰余で新ルーティンの1回目として出せていた。
しかし 8/7 は次の暦窓 `[7/31, 8/31)` に落ちるため件数が振り出しに戻り、
**7/28 から新ルーティンが始まっている事実が失われて**また 1 になっていた。
剰余のごまかしは1つの暦窓の中でしか成立しない。

**対処**: `getBookingProgressIndex` も `resolveEffectiveCycle`（＝`computePlanUsage` と同じ窓）で
数えるようにした。7/28 でロールして窓が `[7/28, 8/29)` になるため、8/7 は素直に2件目になる。
猶予の繰入数も `graceLentToPrevCount` を自前で呼ぶのをやめ、`resolveEffectiveCycle` が返す
`lent` を使う（繰入の判定を2箇所で持たない）。剰余は、同日に上限を超える予約が入って
窓を引き直せない場合の保険として残してある。

## 落とし穴
- **回数の表示を足すときは `resolveEffectiveCycle` を通す。**
  `getCycleWindow` を直接使うと、応当日をまたいだ瞬間にカウントが1に戻る。
- チップ側の呼び出しは `resolveCycleMonths` / `resolveGraceDays` を必ず渡すこと
  （`resolveGraceDays` は `profiles.grace_enabled=false` のお客様で0を返す）。
- 起算日より前の予約はどの窓にも入らないので `getBookingProgressIndex` は `null` を返す
  ＝チップが出ない。トレーナーが起算日をリセットした場合の過去分がこれに当たる（仕様）。
- 回帰テストは `src/test/courseProgress.test.ts` の
  「getBookingProgressIndex × 使い切り後のロール」。本番の実データをそのまま置いてある。
