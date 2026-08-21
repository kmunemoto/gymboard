# プランの回数上限を強制する（2026-08-21）

`tenant_plans.max_sessions`（月4回・月8回…）を、店が望めば**予約時に強制**できるようにした。

## 🔴 2026-08-21 まで「表示だけ」で一度も強制されていなかった

`max_sessions` は以前からあり、`PlanUsageCard` が「残り0回」の赤いバッジまで
出していたが、**押せば普通に予約できた**。DB にもクライアントにも拒否する仕組みは
無く、上限を超えた予約は「次のルーティンの1回目」として窓が引き直され `1/4` と表示された。

`allow_overflow`（boolean・既定 true）も**まさに超過の可否を切り替える意図で作られた
まま未実装のデッドカラム**だった（`src/` からも `supabase/` からも一切読まれていない）。
新しい列を足さず、この2つを繋いで動かした。

| `allow_overflow` | 挙動 |
|---|---|
| `true` / `NULL`（既定・**現在の全42プラン**） | 今までどおり。超過できる。何も変わらない |
| `false` | 上限に達したら **GB004** で拒否。超過によるサイクルの自動ロールも止まる |

## 🔴 超過を許さないときは「サイクルのロール」も止める

既存の表示ロジック（`resolveEffectiveCycle`）は**上限を超えた予約が入ると、その
予約日を起算日にして次のサイクルへ進む**（「回数を使い切ったら次のルーティンが
始まる」という運用の反映）。

超過を拒否するなら、この自動ロールは起きてはならない。もしロールしたままだと:

```
カード「1/8 残り7回」  ←→  DB「上限に達しています」
```

という食い違いが、**設定をONにした時点で既に超過しているお客様に必ず出る**
（しかも店がONにするのは、まさに超過が起きているからなので、確実に踏む）。

そこでクライアント側も `allowOverflow: false` でロールを止める
（`resolveEffectiveCycle` の引数 → `PlanUsageInput` → `resolvePlanUsageInput`）。
これで表示と判定が常に一致する。

## 数え方はクライアントと同一（別に数え直さない）

クライアントの事前判定は **`computePlanUsage` の結果（カードが出しているもの）
そのもの**を使う（`isPlanSessionLimitReached`）。別に数え直すと
「カードは残1回と言うのに拒否される」が起きうる。

DB 側（`guard_booking_plan_limit`）は同じ規則を SQL で再実装している:

```
窓   = plan_cycle_window(profiles.cycle_start_date, 予約日, cycle_months)
       応当日ベース。**応当日そのものは前サイクルに含む**（end は応当日の翌日）
lent = min(前サイクルの残り, 猶予帯[窓頭, 窓頭+grace_days) の予約数)
used = 窓内の有効予約数 - lent
拒否条件: used >= max_sessions
```

- 数える対象は**そのお客様の予約すべて**（`booking_type` では絞らない）。
  表示側が `myBookings` を丸ごと渡しているので、それに揃える
- 除外は `status = 'キャンセル済み'` のみ（**'同日キャンセル済み'（消化）は数える**）
- 猶予OFFのお客様（`profiles.grace_enabled = false`）には猶予を適用しない
- `profiles.cycle_start_date` が NULL＝プラン未確定は判定しない（カードも出ない）
- `max_sessions` が NULL（通い放題）・0以下は上限なし

### ⚠️ `anchorToFirstBooking` は数に影響しない

`computePlanUsage` は表示用に窓を「実際の1回目のトレーニング日」起点へ引き直すが、
`finalizeWindow` を読むと **`used` は元の暦窓から計算したものをそのまま返す**
（引き直すのは表示する期間だけ）。だから DB が暦窓で数えても食い違わない。
ここを読み違えると「表示に合わせて DB も再アンカーが要る」と誤解する。

### 月末のクランプは Postgres と date-fns で一致する

`2026-01-31 + 1ヶ月` はどちらも `2026-02-28`。本番で5ケース突き合わせ済み
（`plan_cycle_window` の出力と date-fns の `getCycleWindow` が完全一致）。

## 🔴 店側の代理予約には適用しない

GB003（時間帯の回数制限）と同じ思想。`auth.uid() = NEW.user_id` の自己予約だけを見る。
「今月はもう上限だけど、事情があるので入れてあげる」を店ができる。

⚠️ トレーナーが代理予約で**自分自身を**お客様として選ぶと自己予約扱いになり
GB004 が出る。TrainerSchedule はこのとき専用文言（`planSessions.errorReachedProxy`）で
プラン設定へ誘導する。

## SQLSTATE の一覧

| コード | 意味 | お客様への案内 |
|---|---|---|
| GB001 | 担当が同時間帯に別予約 | 別の時間なら取れる |
| GB002 | 担当がシフト外 | 別の担当か別の曜日 |
| GB003 | 時間帯の回数上限 | 別の**時間帯**なら取れる |
| **GB004** | **プランの回数上限** | **今サイクルはもう取れない**（次の期間かジムに相談） |

## 画面

- プラン設定（`TrainerPlanManager`）に「**上限を超えた予約を許さない**」のトグル。
  期間プラン（回数無制限）では出さず、常に `true` で保存する
- お客様の予約画面は、上限に達していると**予約ボタン自体を塞ぐ**
  （枠ごとではなく契約単位の話なので、枠のグレーアウトではなくボタンで示す）。
  リスケは塞がない（枠を動かすだけで回数は増えない）

## i18n のキー名に注意

**`planLimit` は既に別物で使われている**（GymBoard の SaaS 料金プランの顧客数上限）。
お客様の契約プランの回数上限は **`planSessions`** にした。
実装中に一度衝突させたので、似た概念の命名は既存キーを先に確認すること。

## 本番適用（2026-08-21）

適用済み（`20260821040000_plan_session_limit.sql`）。適用前に
**全42プランが `allow_overflow = true`** であることを確認済み＝適用しても挙動は変わらない。

実挿入で確認（すべて ROLLBACK。owner / お客様を演じ分け）:

| ケース | 期待 | 結果 |
|---|---|---|
| `allow_overflow=false`・月4回で5件目 | GB004 | ok |
| **既定（true）のまま6件（上限超え）** | 全部通る | ok |
| 上限到達後にオーナーが代理で1件 | 通る | ok |
| 次サイクル（窓の外）はお客様自身でも | 通る | ok |
| 通い放題（max_sessions NULL）＋`false` | 止めない | ok |
| 猶予7日: 猶予帯の2件が前サイクルへ繰入され、さらに4件入る | 通る | ok |
| キャンセル済みは数えない（有効4件で上限） | ok | ok |
| `plan_cycle_window` と date-fns の一致（月末クランプ含む5件） | 一致 | ok |

適用後、`allow_overflow` が既定でないプランは **0件**。

## レビューで確定した6件の修正（2026-08-21・同日）

マージ前の敵対的レビュー（20指摘 → 反証を生き延びた15件）のうち、この機能に関わる6グループ:

### 🔴 1. critical: 会員が profiles を書き換えて GB004 を無効化できた

判定材料の `profiles.plan / cycle_start_date / grace_enabled` は**本人が UPDATE できる**
（「Users can update own profile」）。supabase-js を直接叩けば
(A) 起算日を NULL に → プラン未確定扱いで素通し
(B) plan を実在しない名前に → allow_overflow 不明で素通し
(C) 起算日を今日に → 窓が引き直され再び max_sessions 回取れる。

対策は `guard_profile_plan_fields`（**GB005**・`20260821070000_plan_limit_hardening.sql`）:
- 対象は**本人の自己更新だけ**（店側・サービスロール・店側人間の自分の行は素通し）
- plan / grace_enabled は本人には変えさせない（変える正規の画面が無い）
- cycle_start_date は **NULL→値の初回設定だけ許す**（rebaseCycleStartIfNeeded が
  会員セッションで走るため。塞ぐと新規のお客様に起算日が入らなくなる）。
  既存値の変更は **allow_overflow=false のプランでだけ拒否**
  （既定 true のプランは「使い切ったらロール」の永続化が会員セッションで走る正規動線）

### 🔴 2. 代理予約1件で起算日がロールして上限がリセットされた

`resolveEffectiveCycle`（読む側）にしか allowOverflow を通しておらず、
**書く側**（`shouldRebaseCycleStart` → `profiles.cycle_start_date` の更新）が
素通しだった。上限到達後に店が代理で1件入れる（GB004 は代理を素通し）と
起算日が予約日に書き換わり、窓が引き直されて**もう max_sessions 回取れてしまう**。
→ `shouldRebaseCycleStart` に `allowOverflow` を追加し「使い切ったらロール」の分岐を
ゲート（`useBookings` が select に allow_overflow を足して渡す）。
暦窓が自然に進んだ後のロール（prevCount + lent >= max）は DB と食い違わないので残す。

### 🔴 3. クライアント判定が「今日」基準で、次サイクルの予約まで塞いでいた

DB は**予約日**の属する窓で数える（`v_target := NEW.booking_date`）。クライアントの
`planLimitReached` は `getJSTNow()` 基準のスカラーだったので、今サイクルを使い切った
お客様は **DB なら通る次サイクルの日付まで**画面で塞がれ、応当日が来るまで一切
予約できなかった。→ `isPlanLimitReachedOn(dateKey)`（予約日基準の関数）に変更。
カード表示（PlanUsageCard）は今までどおり今日基準のまま。

### 4. サブスク以外（回数券・期間）には強制しない

トリガーが plan_type を見ず、回数券（購入日起算の窓）にも月次窓で数えていた。
月をまたぐと実質強制されず、月内に集中すると期限内なのに拒否される。
→ トリガー・設定画面・クライアント判定の3箇所すべてで subscription に絞る
（`COALESCE(v_ptype,'subscription') <> 'subscription'` → RETURN NEW /
トグルは subscription でだけ表示・他は true 保存 /
`isPlanSessionLimitReached(usage, allowOverflow, planType)`）。

### 5. 非公開（is_active=false）のプランで判定材料が消えていた

`useTenant().plans` は有効行のみ。DB は is_active を見ずに plan_name で引くので、
プランを非公開にすると**その会員だけ**クライアントが名称推定に落ち、
「カードは残りありなのに GB004 で拒否され続ける」になる。
→ `useTenant` に **allPlans**（全行）を追加し、お客様側の画面
（CustomerBooking / CustomerHome / CustomerSettings / CustomerMonthlyReport）の
契約解決を allPlans に切り替え。**DB 側を is_active で絞る方向は採らない**
（非公開にした瞬間に既存会員の上限が黙って外れるほうが運用上まずい）。

### 6. 定期予約・予約変更で GB004 が「満枠」と誤案内された

スキップ理由の振り分けが GB003 しか見ておらず、GB004 の週が「満枠のため」＝
空き待ちすれば取れる、と案内されていた（待っても絶対に取れない）。
→ 3分割（GB003 / GB004 / その他）＋ `planSessions.repeatSkippedPlan`。
消化リスケは旧行が数えられ続けて**構造的に必ず GB004 で失敗する**ので、
警告を出す前に `planSessions.errorRescheduleForfeitReached` で止める
（非消化リスケは旧行が消える＝純増ゼロなので止めない）。

## SQLSTATE 追記

| コード | 意味 |
|---|---|
| **GB005** | **契約の中身（plan/起算日/猶予）の自己変更の拒否**（guard_profile_plan_fields） |

### 防御強化の本番適用（2026-08-21・`20260821070000_plan_limit_hardening.sql`）

実書き込み9ケースで確認（すべて ROLLBACK。お客様／オーナーを演じ分け）:

| ケース | 期待 | 結果 |
|---|---|---|
| 本人が plan 変更 | GB005 | ok |
| 本人が grace_enabled 変更 | GB005 | ok |
| 本人が起算日変更（プラン既定 true） | 通る（ロール永続化の正規動線） | ok |
| 本人が起算日変更（allow_overflow=false） | GB005 | ok |
| 本人が起算日を初回設定（NULL→値・false プラン） | 通る（rebase の正規動線） | ok |
| オーナーが代理で契約変更 | 通る | ok |
| subscription・上限1 で窓内に既存ありの予約 | GB004 | ok |
| 同・2件目 | GB004 | ok |
| **同条件で plan_type='ticket' に変えた予約** | **通る（月次窓で強制しない）** | ok |

⚠️ 検証時の教訓2つ:
- `auth.uid()` は**ロールではなく `request.jwt.claims` を見る**。RESET ROLE しても
  クレームが残っていると管理側の UPDATE が「本人の自己更新」に化けてガードに当たる。
  管理操作の前に `set_config('request.jwt.claims', '', true)` でクレームを消すこと
- `profiles.tenant_id` は **NULL の会員がいる**（検証に使った会員がそうだった）。
  ガード内の所属解決は profiles.tenant_id ではなく tenant_members から引いている
  （profiles.tenant_id は本人が書ける列でもあるので、判定の根拠にしない）

## 検討したがやらなかったこと

- **新しい列 `max_bookings_per_cycle` を足す**: `max_sessions` と二重管理になる。
  デッドカラムの `allow_overflow` を活かすほうが筋
- **`resolveEffectiveCycle` のロールを SQL でも再現する**: 超過を拒否すれば
  ロール条件（`used > max`）に到達しないので不要。到達しうる既存データは
  クライアント側のロールも止めることで一致させた
- **チケット・期間プランへの適用**: `computePlanUsage` の窓が別（購入日起算・
  月でリセットしない）。回数券の残数管理は別の話なので今回は subscription のみ
  （`plan_type` は見ていないが、`cycle_start_date` × `cycle_months` の窓で数えるため
  実質サブスク向け。チケットに `allow_overflow=false` を付けると意図と違う窓で
  数えることになるので、必要になったら窓の分岐を足す）
