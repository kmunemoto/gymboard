# インストラクター（制限付きスタッフ）（2026-10-28）

## 要望

宗本さん（パーソナルピラティスを始める。ピラティスの先生に来てもらう）:

> お店の設定とか触らせたくないので、お店にログインできるということだけにさせたい。
> お知らせ・動画・設定は触らせないようにして、オーナーとは完全に分けてほしい。
> お店側の画面で、お客さんの削除もできないようにしてほしい。これはオーナーだけができるようにしてほしい。

確認したこと: **先生は全員のお客様を見られてよい**（担当のお客様だけに絞らない）。

予約を「トレーニング／ヨガ／マシンピラティス」に分ける話（予約メニュー）は別の段で作る。

## 🔴 「スタッフ」はなくした（2026-10-28・全部のジム）

スタッフとインストラクターの違いを説明したところ、宗本さん「スタッフいらない」→ 範囲を確かめて**全部のジム**。
ジム側の人は**オーナーとインストラクターだけ**。`supabase/migrations/20261028050000_retire_full_staff.sql`

- スタッフ用の招待コードは捨てた（`tenant_staff_invites.staff_code` は常に NULL・CHECK）。スクリーンショットに写った
  コードでも参加できない。照会・参加の RPC はインストラクター用のコードだけ受け付け、参加した人は必ず `limited`
- **trainer は必ず `limited`**（CHECK `tenant_members_trainer_is_instructor`）。古いアプリの切り替えでも full にできない
- オーナーのスタッフ用コードの RPC: `get_my_staff_invite_code` は NULL、`regenerate_staff_invite_code` は断る
- 🔴 **オーナーの引き継ぎ（`transfer_gym_ownership`）も直した。** 引き継ぎ先は必ずインストラクター（limited）なので、
  新オーナーの `staff_access` を `full` に戻す。戻さないと、店宛ての通知の宛先（`.neq("staff_access", "limited")`・
  `notifiableStaff`。role を見ていない）からオーナーが漏れる。元オーナーはインストラクター（limited）になる
- 画面: スタッフ管理は「インストラクターを追加」と「担当できる人」の一覧だけ（スタッフ用のカード・切り替えスイッチは無い）。
  「スタッフ」という呼び方も画面から外した（`インストラクター管理`・`担当のシフト` など。5言語）
- 古いアプリ（オーナーの端末）: スタッフ管理はスタッフ用のコードで出し分けていたので、**画面ごと出なくなる**
  （古いアプリにはインストラクターのカードが無い）。インストラクターの招待は新しい版から
- 2026-10-28 時点で、どのジムにも trainer の行は0（壊すデータが無かった）
- テスト: `src/test/retireFullStaff.test.ts`

## 形

`tenant_members.staff_access`（text・NOT NULL・既定 `'full'`・CHECK で `full` / `limited` だけ）

| 値 | 誰 | できること |
|---|---|---|
| `full` | オーナー（と、お客様の行の既定値。意味は無い） | — |
| `limited` | **インストラクター**（trainer は全員これ） | 予約・顧客・メッセージ・種目・記録。**店の運営は触れない** |

判定は `is_limited_staff(tenant_id, user_id)`（SECURITY DEFINER）。オーナー・お客様は常に false。
画面側は `src/lib/staffAccess.ts`（`useTenant().isLimitedStaff`）。

## 増やし方

ジム設定 → インストラクター管理の**インストラクター用の招待コード**（お客様用とは別）。
そのリンク（`/join-staff/コード`）から参加した人は `limited`。参加し直し（一度外れた人がもう一度参加）でも `limited`。

（2026-10-28 まではスタッフ用のコードと「スタッフ ⇄ インストラクター」の切り替えスイッチもあった。上の「スタッフはなくした」。
`guard_tenant_member_staff_access` はそのまま残っている＝オーナー以外は staff_access を変えられない）

## 止めているもの（🔴 止めているのは DB。画面で隠すのは使い勝手のため）

`supabase/migrations/20261028020000_instructor_staff.sql`

### 書き込み（RESTRICTIVE ポリシー・41本）

`limited_staff_no_insert` / `_no_update` / `_no_delete`（`TO authenticated`・
`NOT is_limited_staff(tenant_id, auth.uid())`）を次の表に足した。**今あるポリシーは変えていない。**

| 表 | 何か |
|---|---|
| announcements / announcement_audience | お知らせ |
| gym_videos | 動画 |
| booking_options / booking_option_customers / booking_questions / booking_frequency_limits / booking_capacity_windows / booking_blocked_windows | 予約のルール |
| booking_closed_days / booking_uncapped_days | 予定表の「受付を止める」「上限を外す」 |
| staff_schedules | シフト |
| member_payments | 入金の記録 |
| tenant_members（update・delete だけ） | 休会・退会・プランの付け替え・権限 |

- **読むのは止めていない**（SELECT の RESTRICTIVE は無い）。予約表・顧客・記録は見える。
- **止めていないもの**: bookings（代わりの予約）・workouts（記録）・messages・profiles（連絡先）・blocked_slots（予定表の枠のブロック）。
  先生の仕事なので。
- 店の設定（tenants）・プラン（tenant_plans）は、もともとオーナーしか書けない。
- `tenantMembershipWrites.test.ts` は「誰に開いているか」の検査から RESTRICTIVE を外した（絞るだけで何も開けないため）。

### 関数

| 関数 | 変えたこと |
|---|---|
| `delete_customer_cascade` | インストラクターが呼ぶと 42501「お客様の削除はオーナーだけができます」 |
| `guard_profile_plan_fields` | インストラクターは**お客様本人と同じ扱い**。プラン・猶予・起算日の固定は変えられない（GB005）。起算日の初回設定（NULL→日付）は通る＝代わりに予約を入れたときの自動設定は動く |

どちらも本番の定義（`pg_get_functiondef`）に足しただけ。

## 画面

| 場所 | インストラクターには |
|---|---|
| メニュー | お知らせ・動画を出さない（今開いていても）。設定タブは「アカウント」 |
| アカウント（`StaffAccountSettings`） | ジム名・メール・役割・ログアウト・アカウントの削除だけ |
| `TrainerView` | 開けないタブ（覚えていた画面など）は**ホームとして出す**（`shownTab`）。契約・プランの案内バナーを出さない |
| ホーム | 今月の売上・更新のお知らせ・売上グラフ・入金の未記録・受付人数の確認を出さない |
| 顧客一覧 | 削除ボタンを出さない |
| カルテ | 休会・退会・入金を出さない。プラン・起算日（日付・今日に戻す・固定）・猶予は押せない |
| 予定表 | 「受付を止める・上限を外す」は見せるだけ（押せない） |
| 通知設定 | **店の Google カレンダー連携を出さない**（2026-10-28）。つなぐと店の予定の同期先に先生のカレンダーが選ばれ、お客様全員の予約が入りうる。サーバーも google-calendar-sync がインストラクターの連携を使わない（`.neq("staff_access", "limited")`）ので、古いアプリからつないでも店の予定は入らない |

## 通知（🔴 ここを間違えるとオーナー宛ての連絡が先生に行く）

宗本さん（2026-10-28）:

> オーナーは全てを把握してるように。先生には、先生が担当している予約だけ通知が届く様にして。
> オーナーは全ての通知を受け取る。先生に関する通知は先生に届くように。

### 代表はオーナー（2026-10-28 に trainer 優先から改めた）

店宛ての通知の「代表」（店宛てのメール・LINE・お客様のチャットの宛先）は **オーナーが先頭** → スタッフ（joined_at 順）。
インストラクターは代表にも「店のスタッフ全員」にも入れない。

trainer 優先のままだと、インストラクターを外していても、**あとで先生を「スタッフ」に切り替えた瞬間に
店宛てのメールとチャットがオーナーから先生に移る**。オーナー優先にしてこの罠を消した。
（2026-10-28 時点で本番に full のスタッフは0人＝並びを変えても、いま届いている相手は変わらない）

- クライアント: `fetchMyTenantStaffRoster` / `fetchMyTenantStaffIds` / `fetchMyTenantTrainerId`
  （`notifiableStaffOrder`）。権限の列が無い環境では列を外して読み直す
- Edge Function: notify-new-booking（owner → trainer の順）・trial-book / drop-in-book / trial-cancel
  （`find(owner) ?? [0]`）。宛先の読み込みは `.neq("staff_access", "limited")`
  （この4本と send-push-notification の体験プッシュ・daily-trainer-summary の6本）

### 誰に何が届くか

| できごと | オーナー | 先生（インストラクター） |
|---|---|---|
| お客様が予約した | プッシュ＋メール（代表） | 自分が担当ならプッシュ＋メール |
| 店が代わりに予約した（代理予約） | オーナー以外が入れたらプッシュ。メールは毎回（代表） | 自分が担当ならプッシュ＋メール（自分で入れたときは除く） |
| お客様が日時を変えた | プッシュ（＋LINE） | 自分が担当ならプッシュ |
| キャンセル（お客様・店） | プッシュ＋メール（＋LINE） | 自分が担当ならプッシュ＋メール。店が取り消したときは「店が」と書く |
| 担当の付け替え | オーナー以外が付け替えたらプッシュ | 前か後の担当ならプッシュ |
| オプションの変更（店） | オーナー以外が変えたらプッシュ | 自分が担当ならプッシュ |
| 朝の本日の予定 | その日の全部の予約と体験 | 自分が担当の予約だけ（「本日の担当（N件）」・店の分とは別のキー）。🔴 **本番では動かしていない**（cron 未登録。2026-10-28 に宗本さん「いらないです」・`mem/features/daily-trainer-summary.md`） |
| 体験・ドロップイン | 代表として受け取る | 届かない（体験はトレーニングだけ） |
| お客様のチャット | 代表として受け取る（いつでも） | **自分のお客様なら**プッシュ（予約の担当30日前から先・30日以内にやりとり。下の「お客様からの通知」） |
| お知らせ・リマインダー | （お客様宛て） | （お客様宛て） |

- 店側の操作の宛先は `staffChangeRecipients`（`src/lib/staffAccess.ts`）:
  **予約の担当（前・後）＋（オーナー以外が操作したら）オーナー − 操作した本人**
  - 🔴 「インストラクターが操作したら」ではなく「オーナー以外が操作したら」。先生をスタッフに切り替えてもオーナーに届く
  - オーナーが自分で担当のいない予約を動かしたときは誰にも送らない（今まで通り）
  - 操作した人が読めないときはオーナーに倒す（知らせ漏れより余分な1通のほうが害が小さい）
- 送っている場所:
  - 代理予約 … notify-new-booking（サーバー。操作した人は `booking_notify_log.actor_user_id`）
  - 付け替え・オプション … `src/lib/staffNotify.ts`（クライアント・fire-and-forget。成功したあとに呼ぶ）
  - キャンセル・日時の変更 … `useBookings`（`withAssignedStaff`）
  - 朝 … daily-trainer-summary
- メールの冪等キー: 新しい予約は代表 `booking-notify-<id>`・担当 `booking-notify-<id>-staff`。
  キャンセルは代表 `cancel-trainer-<id>`（今まで通り）・担当 `cancel-trainer-<id>-<user_id>`
- 担当へのメールは `_resolve_trainer_` ＋ `trainerUserId`（send-transactional-email は同じジムの現役スタッフなら
  宛先にできる。インストラクターも含む）

⚠️ Edge Function は push しても本番に出ない。Lovable にデプロイを頼む（`mem/ops/edge-function-deploy.md`）。

### お客様からの通知は「代表の1人＋先生」か「代表の1人」か（2026-10-28）

宗本さん「お客様→代表の1人+先生、もしくは、お客様→代表の1人。これを考えて使い分けて」

| お客様の操作 | 代表（オーナー） | 先生（代表以外のスタッフ） |
|---|---|---|
| 予約・日時の変更・キャンセル | いつでも | **その予約の担当なら**（トレーニングの予約は代表だけ） |
| チャット | いつでも | **そのお客様の担当なら**: そのお客様の予約の担当（30日前から先）か、30日以内にそのお客様へメッセージを送った人 |
| 体験・ドロップイン | いつでも | 届かない（体験はトレーニングだけ） |

- チャットは行の宛先（receiver_id）では決めない。notify-new-message が「代表＋関係するスタッフ」を出す
  （`supabase/functions/_shared/staffRouting.ts` の `chatRecipients`）。トレーニングだけのお客様は代表だけ。
  先生が自分からお客様に送った会話の返事は先生にも届く
- 判定は `supabase/functions/_shared/staffRouting.ts`（import なし・vitest から直接テスト）。DB を読むのは各 Edge Function

### 🔴 古いアプリとの共存（先生が参加した日から効く）

2026-10-28 より前のアプリは、代表を **「スタッフ優先」** で選び、インストラクターも外さない
（端末に配られたアプリは書き換えられない）。先生が参加すると、古いアプリでは**先生が代表**になり、
キャンセル・日時の変更はスタッフ全員（先生を含む）に送ってくる。受け取るサーバー側で上の表どおりに振り分け直す。

| 古いアプリの送信 | そのままだと | サーバーでの振り分け |
|---|---|---|
| お客様のチャット（宛先＝先生） | 先生だけに届き、オーナーに届かない | notify-new-message: 代表＋関係するスタッフ（上の表） |
| キャンセルの店宛てメール（`cancel-trainer-<予約id>`・宛先＝先生） | 先生だけに届く | send-transactional-email: 代表へ送り直し、**先生の担当の予約なら**先生にも写し（`cancel-trainer-<予約id>-<user_id>`）。`resendTargets` |
| 新しい予約の店宛てメール（`booking-notify-<予約id>`・端末から送っていたころのアプリ） | 先生だけに届き、サーバーのオーナー宛てが重複で消える | 代表へ送り直す（先生の担当なら、サーバーが `-staff` で別に送っている） |
| キャンセル・日時の変更のプッシュ（スタッフ全員） | 担当でない予約まで先生に届く | send-push-notification: **担当でない先生を外す**（`dropUnassignedInstructors`）。どの予約かはタグから読む |

- キャンセルは予約の行を消すので、通知が届いた時点では担当が分からない。**`booking_notify_log.staff_user_id`**
  （`20261028040000_booking_notify_log_staff.sql`）に消える前の担当を残し、それを引く
- 担当が分からないとき（記録が無い等）は先生にも送る（届かないより、届くほうがまし）
- 今のアプリとサーバーは、代表のキーを先生に使わない（先生への写しは `-<user_id>` / `-staff` 付き）。
  ここが崩れると先生への写しまで送り直しの対象になる（`src/test/staffNotifications.test.ts` が見ている）
- オーナー自身の端末も更新すること（古い店側アプリも同じ並びで選ぶ。店の操作のプッシュはサーバーで振り分けるが、
  付け替え・オプションの通知は新しいアプリにしか無い）

## 招待コードの置き場所を移した（セキュリティ）

`tenants.staff_invite_code` は「オーナーだけが RPC で読む」つもりで列単位の REVOKE をしていたが、
authenticated に表全体の SELECT が付いているため**効いていなかった**。
本番で「ログインしたお客様が自分のジムのスタッフ用コードを読める」ことを確認した。
お客様が別のアカウントを作ってそのコードで参加すると、スタッフとして全員の顧客情報が見える。
（確認時点でオーナー以外のスタッフはどのジムにも居ない＝使われた形跡は無い）

- コードは `tenant_staff_invites`（tenant_id・staff_code・instructor_code）。**RLS を有効にしてポリシーを作らない**
  ＝関数からしか読めない。anon / authenticated から表の権限も外した。
- `tenants.staff_invite_code` は常に NULL（CHECK `tenants_staff_invite_code_unused` で固定）
- RPC の名前・引数は今まで通り（`get_my_staff_invite_code` 等）。中身は `_owner_staff_invite_code(kind, regenerate)`
  （authenticated からも直接は呼べない）
- 足した RPC: `get_my_instructor_invite_code()` / `regenerate_instructor_invite_code()`
- `lookup_tenant_by_staff_invite_code` / `join_tenant_as_staff_with_invite_code` はどちらのコードでも引ける。anon には渡さない
- `delete_my_gym` はこの表も消す（`20261028020100_delete_gym_staff_invites.sql`）

## 本番（2026-10-28 に適用・確かめたこと）

ロールを演じて確かめた（`ROLLBACK` で戻る）:
- インストラクター用のコードで参加 → `limited`。お知らせ・休業日・入金・退会・自分の権限の書き換え・お客様の削除・
  プランの変更（GB005）は断られる。予約表・顧客を読む・記録を付けるのは通る
- 今まで通りのスタッフは休業日を付けられるが、権限は変えられない。オーナーだけが切り替えられる
- インストラクター用のコードを作り直すと古いコードで参加できない。anon は照会できない
- お客様は今まで通り（招待コードは読めなくなった）

## 予約メニューとの関係

先生を追加すると、スタッフが2人になり**お客様の予約画面に担当の選択が出る**（`canSelectStaff`）。
予約メニュー（`mem/features/booking-menus.md`）を使い始めると担当の選択は消え、メニューで担当が決まる。
招待 → 先生のシフト → メニューの担当を先生に、を続けて行う。
古いアプリ（予約メニューを知らない版）は担当の選択を出し続ける。担当のメニューがすべてオフの先生は、
お客様が指名しても DB が GB002 で断る（`trg_guard_booking_menu_teacher`・2026-10-29）。

**1人の先生が複数のメニューを担当できる**（宗本さんのジムはヨガとマシンピラティスが同じ先生）。
スタッフ管理の一覧と先生の「アカウント」画面に「担当メニュー: ヨガ・マシンピラティス」が出る。

## テスト

`src/test/instructorStaff.test.tsx`・通知の宛先は `src/test/staffNotifications.test.ts`
