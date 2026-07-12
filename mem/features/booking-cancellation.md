# 予約キャンセル（同日キャンセルの自動消化ペナルティ）

## 通常のキャンセル

会員予約（`bookings`テーブル）のキャンセルは `src/hooks/useBookings.ts` の
`cancelBooking(bookingId, cancelledByTrainer, opts)` に一本化されている。
お客様の自己キャンセル（`CustomerBooking.tsx`）・トレーナーのキャンセル
（`TrainerSchedule.tsx`）の両方がこの同じ関数を呼ぶ。

**通常は行を物理DELETEする**（トレーナーの日程変更内部呼び出し `rescheduleBooking`
も同様に物理DELETE）。体験予約（`trial_bookings`）はこれとは別で、元々
ソフトキャンセル（`status = 'キャンセル済み'` へUPDATE）。

## 同日キャンセルの自動消化ペナルティ（2026-07〜、ジムごとON/OFF）

### 背景
パーソナルジムの1枠は代替販売できない消えもの。同日キャンセルを無条件で許すと
直前キャンセルの機会コストをジムが常に負う。テナントごとに運用方針が違う
（CLAUDE.md: 特定テナント専用の変更を全テナントに適用しない）ため、
`tenants.same_day_cancel_penalty_enabled`（既定 `false`）でジムごとに
ON/OFFできるようにした。設定画面は `TrainerGymSettings.tsx` の「予約ポリシー」。

### 仕組み: 新しいstatus値を使う（boolean列は使わない）
同日キャンセルがペナルティ対象のとき、`cancelBooking` は物理DELETEの代わりに
`status` を `SAME_DAY_FORFEIT_STATUS`（`"同日キャンセル済み"`、
`useBookings.ts` でexport）へUPDATEする。

この値は既存の `"キャンセル済み"` とも `"予約済み"` とも異なる文字列であるため、
既存コードの「`キャンセル済み`/`予約済み`と厳密一致/不一致」で書かれた各所が
**無改修のまま**意図通りに振る舞う:

| 既存チェック | 判定 | 結果 |
|---|---|---|
| `courseProgress.ts` / `planUsage.ts`（`status !== "キャンセル済み"` を消化数に加算） | 不一致 → 加算対象 | 消化数に数えられる |
| `push-booking-reminder` / `push-booking-reminder-hourly` / `line-booking-reminder`（`status === "予約済み"` 厳密一致） | 不一致 → 対象外 | 来ないはずのリマインドが飛ばない |
| `TrainerSchedule.tsx` の枠検索・`calendar-feed`（`status !== "キャンセル済み"` で表示） | 不一致 → 表示継続 | トレーナーの予定表・外部カレンダーに枠として残る |

**意図的な簡略化**: 上記の通り枠は「占有されたまま」残る（`checkSlotBlocked` も
同様に不一致なので占有扱い）。同日キャンセルされた枠を他のお客様に再販できる
ようにはしていない（現実的にほぼ発生しないケースのため）。同じ理由で、
消化扱いキャンセル時はキャンセル待ちへの「空きました」通知もスキップする
（`cancelBooking` 内、`opts.forfeit` 時は `waitlist_slot_freed` を送らない）。

boolean列（例: `bookings.forfeited`）を追加する案も検討したが、その場合は
リマインダー3関数を個別に「forfeited=trueを除外」するよう改修する必要が
あり、新しいstatus値を使う方が改修範囲が小さく安全と判断した。

### 誰が消化扱いにするか
- **お客様が自分でキャンセル**（`CustomerBooking.tsx`）: 同日 かつ
  テナント設定ON なら常に自動で消化扱いにする。ただし「キャンセルする」を
  押した直後に同じダイアログ内で警告文＋もう一度の確定ボタンを挟む
  2段階確認にしている（`forfeitPending` state）。
- **トレーナーがキャンセル**（`TrainerSchedule.tsx`）: 同日 かつ
  テナント設定ONの対象には削除確認ダイアログに「消化扱いにする」
  チェックボックス（既定ON）が出る。トレーナー都合（体調不良等）で
  キャンセルする場合はチェックを外せば消化扱いにしない、という運用を
  想定（`forfeitChecked` state、`deleteTargetForfeitable` で対象判定）。
- 日程変更（`rescheduleBooking`）は forfeit対象外。来店予定が変わるだけで
  「来なかった」わけではないため。

### 通知文言
LINE・メール（`booking-cancellation.tsx` テンプレートの `forfeit` prop）・
pushの3経路とも、消化扱いになった場合は本文に一言（「今回のキャンセルは
1回消化扱いとなりました」等）を追記する（`sendCancelLineNotification` /
`sendCancelEmailNotification` / `sendCancelPushNotification` の `forfeit` 引数）。

### 落とし穴
- `useTenant.ts` の `Tenant` interface とテナント取得の select文の両方に
  カラムを追加する必要がある（select文への追加を忘れると設定が読めない）。
- 新しいstatus文字列はマジックストリングの重複を避けるため
  `useBookings.ts` の `SAME_DAY_FORFEIT_STATUS` を必ずimportして使う
  （直書きしない）。
- `CustomerBooking.tsx` の `activeBookings`（お客様自身の「予約中」一覧）は
  `SAME_DAY_FORFEIT_STATUS` も明示的に除外している。他の一覧系フィルタで
  `status === "キャンセル済み"` だけを見ているものが今後増えたら、この
  新ステータスも一緒に除外するかどうかを個別に検討すること（カウント系は
  自動的に正しく動くが、UI一覧系は「見せたいか」次第で判断が分かれる）。
