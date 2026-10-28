# インストラクター（制限付きスタッフ）（2026-10-28）

## 要望

宗本さん（パーソナルピラティスを始める。ピラティスの先生に来てもらう）:

> お店の設定とか触らせたくないので、お店にログインできるということだけにさせたい。
> お知らせ・動画・設定は触らせないようにして、オーナーとは完全に分けてほしい。
> お店側の画面で、お客さんの削除もできないようにしてほしい。これはオーナーだけができるようにしてほしい。

確認したこと: **先生は全員のお客様を見られてよい**（担当のお客様だけに絞らない）。

予約を「トレーニング／ヨガ／マシンピラティス」に分ける話（予約メニュー）は別の段で作る。

## 形

`tenant_members.staff_access`（text・NOT NULL・既定 `'full'`・CHECK で `full` / `limited` だけ）

| 値 | 誰 | できること |
|---|---|---|
| `full` | 今まで通りのスタッフ（既定） | 今まで通り |
| `limited` | **インストラクター** | 予約・顧客・メッセージ・種目・記録。**店の運営は触れない** |

判定は `is_limited_staff(tenant_id, user_id)`（SECURITY DEFINER）。オーナー・お客様は常に false。
画面側は `src/lib/staffAccess.ts`（`useTenant().isLimitedStaff`）。

## 増やし方

ジム設定 → スタッフ管理に、スタッフ用とは**別のインストラクター用の招待コード**が出る。
そのリンク（`/join-staff/コード`）から参加した人は**最初から** `limited`。
あとから一覧のスイッチでオーナーが切り替えられる（スタッフ ⇄ インストラクター）。

- 🔴 **切り替えられるのはオーナーだけ。** `guard_tenant_member_staff_access`（BEFORE UPDATE OF staff_access）が
  `current_user = 'authenticated'` かつオーナーでない変更を 42501 で断る。
  今まで通りのスタッフも、インストラクターが自分で戻すこともできない。
  関数の中（参加の RPC）からの変更は通す。
- 参加し直し（一度外れた人がもう一度参加）でも、使ったコードで権限が決まる。

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

## 通知（🔴 ここを間違えるとオーナー宛ての連絡が先生に行く）

店宛ての通知の「代表」は **trainer 優先**（joined_at 順）→ owner。インストラクターを外さないと、
先生が先頭になり、**オーナーに届いていたメール・お客様のチャットの宛先が先生に移る**。

- クライアント: `fetchMyTenantStaffIds` が `notifiableStaff` で外す（列の無い環境では列を外して読み直す）
- Edge Function（6本）: `.neq("staff_access", "limited")`
  - notify-new-booking / trial-book / drop-in-book / trial-cancel / send-push-notification（体験のプッシュ）/ daily-trainer-summary
- **自分が担当の予約だけは届ける**: 新しい予約（notify-new-booking のプッシュに `booking.staff_user_id`）、
  予約の変更・キャンセル（`useBookings` の `withAssignedStaff`）

⚠️ Edge Function は push しても本番に出ない。Lovable にデプロイを頼む（`mem/ops/edge-function-deploy.md`）。

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

## テスト

`src/test/instructorStaff.test.tsx`
