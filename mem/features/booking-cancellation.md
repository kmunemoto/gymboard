# 予約キャンセル（同日キャンセルの自動消化ペナルティ）

## 通常のキャンセル

会員予約（`bookings`テーブル）のキャンセルは `src/hooks/useBookings.ts` の
`cancelBooking(bookingId, cancelledByTrainer, opts)` に一本化されている。
お客様の自己キャンセル（`CustomerBooking.tsx`）・トレーナーのキャンセル
（`TrainerSchedule.tsx`）の両方がこの同じ関数を呼ぶ。

**通常は行を物理DELETEする**（トレーナーの日程変更内部呼び出し `rescheduleBooking`
も同様に物理DELETE）。体験予約（`trial_bookings`）はこれとは別で、元々
ソフトキャンセル（`status = 'キャンセル済み'` へUPDATE）。

## 用語: お客様向けは「当日キャンセル」に統一（2026-07）

以前は「同日キャンセル」と「当日キャンセル」が混在していた。ジム設定のトグルに至っては
タイトルが「同日キャンセルを…」で説明文が「当日キャンセルされた予約は…」と、
**同じブロックの中で食い違っていた**。メールは「同日」、画面とプッシュは「当日」。

**お客様/トレーナーの目に触れる日本語は「当日キャンセル」に統一した。** 理由は、
お客様がキャンセルを確定する直前に見る警告（`booking.sameDayForfeitWarningDesc`）が
「当日キャンセルは…」であり、他4言語（same-day / 당일 / 当天 / 當天）とも語義が一致するため。
他4言語は元々統一されていたので、変更したのは日本語だけ。

**変えていないもの:**

- `SAME_DAY_FORFEIT_STATUS = "同日キャンセル済み"` — **DBに保存される値**。本番の
  `bookings.status` に既にこの文字列が入っており、書き換えると消化数カウントも
  予定表の表示も既存行を拾えなくなる。画面には出ないので統一の対象外。
- コード中のコメントの「同日キャンセル消化」 — 上のDB値を指しているので、
  ここだけ「当日」にすると定数名と食い違って逆に読みにくい。
- 課金の「毎月同日に自動更新」 — 別の意味の「同日」。

`src/test/sameDayCancelWording.test.ts` が上記をまとめて見張る
（UI文言・メール・プッシュ/LINEに「同日キャンセル」が残っていないこと、
DBのstatus値が据え置きであること、課金文言を巻き込んでいないこと）。

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
| `checkSlotBlocked` / `CustomerBooking.tsx` の枠検索・DBの `check_booking_overlap`（`!== "キャンセル済み"` で占有判定） | 不一致 → 占有扱い | 同日キャンセルされた枠は他のお客様に再販できない（消化済みなので枠自体は空けない） |

**枠は占有されたまま残る**（意図的な簡略化）。同日キャンセルされた枠を他のお客様に
再販できるようにはしていない（現実的にほぼ発生しないケースのため）。同じ理由で、
消化扱いキャンセル時はキャンセル待ちへの「空きました」通知もスキップする
（`cancelBooking` 内、`opts.forfeit` 時は `waitlist_slot_freed` を送らない）。

**トレーナー側の予定表からは非表示**（2026-07〜）。上記の「枠は占有されたまま」は
予約可否の判定（`checkSlotBlocked` 等）の話であり、**トレーナー自身が見る予定表の
表示**は別の話。当初は `status !== "キャンセル済み"` の不一致を利用してグレー表示
のまま予定表に残す設計だったが、「ジム側の予約に残っているので消してほしい」との
要望を受け、トレーナー向けの表示系（`TrainerSchedule.tsx` の `getSession`/
`getDayBookings`、`WeekTimelineView.tsx` の `dayBookings`、`TrainerDashboard.tsx` の
`todayBookings`＝本日のスケジュール）は明示的に `SAME_DAY_FORFEIT_STATUS` も除外
するよう変更した。**進捗バッジ用の消化数カウント（`bookingsByUser`）は非フィルタの
ままなので影響なし**（表示用の配列だけを絞り込み、カウント用の配列は触っていない）。
`sameDayForfeitBadge` のグレー表示バッジ・i18nキーは表示箇所が無くなったため削除済み。
なお `calendar-feed`（お客様自身の個人カレンダー購読、`profiles.calendar_token` 経由）
は対象外（トレーナー側の予定表ではないため今回は変更していない）。

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
- 日程変更（`rescheduleBooking`）: **別日への変更は forfeit対象外**（来店予定が
  変わるだけで「来なかった」わけではない）。ただし **当日予約を変更する場合は、
  テナント設定ONなら当日キャンセルと同じく消化扱いにする**（`opts.forfeitOld`、#132）。
  「変更」ボタンで当日消化を回避できないようにするため。当日変更の消化は、旧枠を
  物理DELETEせず `SAME_DAY_FORFEIT_STATUS` へUPDATEして残し、新枠をINSERTする。
  お客様側は `CustomerBooking.tsx` の `rescheduleTargetForfeits`＋2段階確認
  （`rescheduleForfeitPending`）で警告を出す。

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

- **判断の目安（実際に洗い出して修正済み）**: `status === "キャンセル済み"` /
  `.neq("status", "キャンセル済み")` を書いている箇所は、意味によって
  `SAME_DAY_FORFEIT_STATUS` の扱いが逆になる。以下の基準で判断する。
  - 「実際に来店/実施したか」を見ている（来店回数・ストリーク・達成バッジ・
    称号・シェア画像の累計回数・予約カレンダーの丸印・「本日◯件予約済み」の
    トースト・お客様自身の予約一覧・トレーナー側の次回予約/最終来店日）
    → **除外する**（消化済みは来店していないので含めない）。
    修正済み: `CustomerHome.tsx`（次回予約カード・来店回数・累計セッション数）、
    `CustomerTraining.tsx`（累計セッション数）、`CustomerSettings.tsx`
    （予約履歴一覧）、`CustomerMonthlyReport.tsx`（月間の来店予約）、
    `CustomerBooking.tsx`（カレンダーの丸印・「本日は既に予約済み」トースト）、
    `useStreak.ts`（週間ストリーク）、`useAvatar.ts`（達成数・称号判定）、
    `useProfile.ts`（トレーナー側の次回予約/最終来店日）、
    `missionRewards.ts`（時間帯ミッション判定）、
    `TrainerDashboard.tsx`（離脱検知の最終来店日・今後予約の有無）、
    `calendar-feed`（お客様の購読ICSカレンダー配信）。
  - 「プラン消化数（回数上限との比較）」を見ている（`courseProgress.ts` /
    `planUsage.ts` 全般、`CustomerHome.tsx` の `cycleBookings`＝「今回n/m回目」）
    → **除外しない**（消化済みなので数える。これが機能の本来の目的）。
  - 「予約枠が空いているか」を見ている（`checkSlotBlocked` / 枠グリッド表示 /
    `CustomerBooking.tsx` の `fetchBookedSlots` / DBの `check_booking_overlap`
    トリガー） → **除外しない**（同日枠は再販できない前提なので埋まったまま）。
  - 新しく `status === "キャンセル済み"` 系のチェックを書く/見つけたときは、
    上記3分類のどれに当たるか確認してから `SAME_DAY_FORFEIT_STATUS` の
    扱いを決めること。

### 追加で見つかった不具合と修正（トレーナー側予約表が更新されない）
お客様が同日キャンセル（消化扱い）した予約が、トレーナー側の「予約」タブの
カレンダーを開いたままだと反映されず、通常予約のまま残って見える不具合が
あった。原因は2つ:
1. `useAllBookings`（`useBookings.ts`）は`useAllCustomerProfiles`と違い、
   マウント時に一度fetchするだけでrealtime購読が無かった。お客様側の操作
   （別セッション/別タブ）で`bookings`が変わっても、トレーナー側の画面を
   開きっぱなしだと再取得されない。→ `bookings` / `trial_bookings` /
   `blocked_slots` テーブルへのrealtime購読を追加して自動再取得するように
   修正（`useMyBookings`にも同様に`user_id`フィルタ付きで追加、トレーナー側
   操作がお客様側の開きっぱなし画面に反映されない逆方向の抜けも解消）。
2. `TrainerSchedule.tsx`の`handleDeleteBooking`は、消化扱い（forfeit）で
   キャンセルした場合も無条件に`removeBooking(target.id)`でローカル一覧
   から消していた。消化扱いは物理削除ではなくstatus更新なので、本来は
   グレー表示＋「同日キャンセル済み」バッジで枠に残るべきところが、
   トレーナー自身の操作直後は一時的に枠ごと消えて見えていた。
   → forfeit時は`removeBooking`ではなく`refetch()`するよう修正。

## サーバー側での消化強制（2026-07、migration 20260713010000）

消化の判定・警告は元々すべてクライアント(JS)側だったため、API直叩き・端末の
時計偽装・古いPWAキャッシュで消化を回避できる穴があった（消化回避の3経路）:
1. 当日予約を物理 DELETE する
2. `booking_date` を直接 UPDATE して別日へ移す（重複防止トリガーは INSERT 限定の
   ため二重予約も可能だった）
3. `status` を `'キャンセル済み'` に直接 UPDATE してソフトキャンセルする（消化除外）

これを `bookings` テーブルへのDB権限剥奪＋トリガーで一括して塞いだ（顧客のみ対象。
トレーナー(スタッフ)＝`has_role(...,'trainer')` とサービスロール＝`auth.uid() IS NULL`
は対象外）:
- **REVOKE UPDATE (booking_date) FROM authenticated, anon** … 日時の直接書き換え・
  UPDATE経由の二重予約を列レベルで不可能に。status更新(消化/復元)は別列なので可能。
- **BEFORE DELETE トリガー `enforce_booking_same_day_delete`** … 消化ONテナントで
  当日(JST・サーバー時刻判定)予約の物理削除を顧客に禁止。当日キャンセルは消化
  (status更新)経路しか使えなくなる。
- **BEFORE UPDATE トリガー `enforce_booking_update_guard`** … 顧客が status を
  `'キャンセル済み'` へ遷移させるのを禁止（ソフトキャンセルでの消化回避を塞ぐ）。

### 落とし穴・不変条件（今後壊さないための注意）
- `bookings.booking_date` を UPDATE する経路を**足してはいけない**（REVOKEで顧客からは
  失敗する）。日時変更は従来どおり「旧枠をDELETEまたは消化 → 新枠をINSERT」で行う。
- 顧客経路で `bookings.status = 'キャンセル済み'` を書き込む処理を**足してはいけない**
  （トリガーで拒否される）。キャンセルは物理DELETEか消化(同日キャンセル済み)のみ。
- 新しい消化ON/OFF条件やキャンセル経路を足すときは、上のDB強制と齟齬が出ないか確認する。

## 追加補強（2026-07、当日変更まわりの穴 B/C/E）

当日予約の変更（消化）フローに残っていた3つの穴を塞いだ。

- **B: リスケ失敗時にGoogleカレンダー予定が復元されない**（クライアント） … 当日変更（消化）の
  内部処理は「旧枠を消化(status更新)＋旧枠のGoogleカレンダー予定を削除 → 新枠を作成」。
  新枠の作成に失敗すると旧枠の status を `'予約済み'` に戻すが、削除済みのカレンダー
  予定は status を戻すだけでは復活しない（`google_event_id` も null 済み）。
  → ロールバック時に `resyncCalendarCreate(bookingId)`（`useBookings.ts`）で
  カレンダー予定を作り直す。best-effort（失敗しても予約復元自体は成立させる）。
  ※別日変更（非消化）のロールバックは `createBooking` で新規行＋新規予定を作るため元々問題なし。

- **C: 消化済み予約を顧客が翌日以降にDELETEして消化を巻き戻せる**（DB・適用済み） …
  当日削除ガードは「当日(JST)の予約」だけが対象だったため、消化行（`status='同日キャンセル済み'`）は
  翌日になると当日判定から外れ、顧客が API 直叩きで DELETE でき、`courseProgress` の消化数から
  外れてしまう。→ `enforce_booking_same_day_delete` を拡張し、`status='同日キャンセル済み'` の行は
  当日/翌日以降を問わず顧客の物理削除を禁止（トレーナー/サービスロールは対象外）。
  migration は `20260713143813`（Lovable 適用済み）。消化を `'予約済み'` へ戻す正規経路
  （Bのロールバック）は UPDATE なので影響なし。

- **E: 当日変更の消化がトレーナー/オーナーへの変更通知に出ない**（クライアント） …
  `sendRescheduleToTrainer` に `forfeit` 引数を追加し、当日変更で消化になった場合はプッシュ本文に
  「（変更前の予約は当日のため1回消化）」、LINE本文に「※当日の変更のため、変更前のご予約は
  1回消化扱いになりました。」を追記する。消化数が増えたことをジム側が把握できる。

## 消化の事後帳消し対策（2026-07、migration 20260715000000）

C 対応後の監査で見つかった残穴を塞いだ。顧客が API 直叩きで
「①翌日以降に消化行の status を『予約済み』へ戻す（更新ガードは『キャンセル済み』への
遷移しか見ていなかった）→ ②過去日になった行を DELETE（当日ガード・消化行ガードの
どちらも通らない）」の2段で消化を帳消しにできた。さらに②は消化機能と無関係に
**過去の消化済みセッション行を削除して回数カウントを回復できる**、以前からの穴でもあった。

- `enforce_booking_same_day_delete` に「**顧客は過去日(JST)の予約を削除不可**」を追加
  （ステータス不問・全テナント）。正規フローに過去予約の削除導線は無い
  （`CustomerBooking.tsx` の `activeBookings` は未来の予約のみ表示）。トレーナーは対象外。
- `enforce_booking_update_guard` に「**顧客は『同日キャンセル済み』からの status 変更を
  予約日当日(JST)しか行えない**」を追加。正規の巻き戻し（B のリスケ失敗ロールバック）は
  消化の数秒後＝必ず当日中に走るため壊れない。
