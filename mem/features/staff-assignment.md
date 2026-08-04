# 予約の担当スタッフ（複数トレーナー対応）

2026-08-04 追加。トレーナーが複数いるジム向けに、
**予約に担当を持たせる**／**ジム側でスタッフを追加・削除できる**ようにした。

業種によって呼び方が違う（トレーナー／施術者／コーチ／担当者…）ので、
コード側の語彙は `staff` に統一し、画面文言は i18n キー `staff.*` に寄せてある。
兄弟アプリは `src/locales/vertical.ja.json` のオーバーレイだけで言い換えられる。

---

## 1. キャパシティとの関係（設計の要）

既存の `tenants.booking_capacity` は「同じ時間帯に**店として**受けられる予約の数」
（ベッド数・施術者数など。`mem/features/booking-capacity.md`）。
**この意味は変えていない。** 担当は、その上に重ねる**追加の制約**として入れた。

| | 判定 | いつから |
|---|---|---|
| 店全体 | 重なる予約が `booking_capacity` 件に達したら拒否 | 従来のまま |
| ブロック枠 | 件数に関係なく店全体を塞ぐ | 従来のまま |
| 担当者ごと | 同じスタッフに時間の重なる予約は入れられない | **今回追加** |

`bookings.staff_user_id` が NULL（＝指名なし／未割当）の予約は担当者判定の対象外。
既存の予約は全て NULL なので、**マイグレーション単体では挙動が一切変わらない**。

### 多トレーナー店の設定手順
1. ジム設定 →「同時に受けられる予約数」をスタッフ人数（またはベッド数）に上げる
2. スタッフ管理からスタッフを追加する
3. 予約時に担当を選ぶ

**capacity を上げないと2人目の予約が入らない。** 担当者数から capacity を自動で
算出しない理由は、ベッド数とスタッフ数が一致するとは限らないため
（自動化すると「設定を変えていないのに受入数が変わる」ことになる）。
「ベッド3台・スタッフ2名」は capacity=3 ＋ 担当者制約の重ね合わせで正しく表現できる。

---

## 2. DB

`supabase/migrations/20260804000000_booking_staff_assignment.sql`

- `bookings.staff_user_id uuid`（NULL可）＋ 部分索引
- `guard_booking_staff_assignment()` … BEFORE INSERT/UPDATE。
  担当は「そのテナントの `tenant_members` にある active な owner/trainer」でなければ拒否。
  **bookings に列単位の GRANT が無く、クライアントから任意の uuid を書けるため必須。**
  他店のトレーナーや存在しないユーザーが担当に入ると、予定表・通知・重複判定が
  エラーを出さずに壊れる。
  **担当が変わっていない UPDATE は検証しない**（後述の罠）。
- `guard_booking_staff_reassign()` … BEFORE UPDATE。担当を差し替える UPDATE のときだけ、
  差し替え先が同じ時間帯に別の予約を持っていないか確認する。
  既存の `prevent_booking_overlap` は **INSERT のみ**（予約変更は「作ってから消す」方式のため）
  で、その方針は変えていない。担当変更は今回新設した導線なのでここだけ追加で見る。
- `check_booking_overlap()` … 担当者単位の重なり件数を追加。
- `get_tenant_booked_slots()` … `staff_user_id` を返すよう変更（DROP → 再作成 → 再 GRANT）。

### ⚠️ `NEW.staff_user_id` と書いてはいけない
`check_booking_overlap()` は `bookings` と `trial_bookings` の**両方**の
トリガーから呼ばれる（`prevent_booking_overlap` / `prevent_trial_booking_overlap`）。
`trial_bookings` に `staff_user_id` 列は無いので、直接参照すると
**体験予約の登録だけが実行時に落ちる**。既存の `source` と同じく
`to_jsonb(NEW) ->> 'staff_user_id'` で読む。
`src/test/staffAssignment.test.ts` がこれを見張っている。

### ⚠️ 「担当が変わっていない UPDATE」を検証してはいけない
`guard_booking_staff_assignment` が UPDATE のたびに担当の在籍を確認すると、
**スタッフが辞めた瞬間に、その人が担当だった予約を一切さわれなくなる**
（キャンセルもメモ追記も「選択された担当者はこのジムのスタッフではありません」で落ちる）。
在籍が外れる経路は2つあり、どちらも普通の運用で起きる:

- `tenant_members.status` は owner/trainer が UPDATE できる（退会処理）。
  行の同一性トリガー（`20260803120000`）が止めるのは `user_id` / `tenant_id` / `role` だけで、
  **`status` は変えられる。**
- `tenant_members` の行はオーナーが DELETE ポリシーで直接消せる
  （`remove_staff_member` を通さない経路）。

このガードの目的は**不正な書き込みを止めること**であって、過去の行を後から
無効化することではない。`TG_OP = 'UPDATE'` かつ担当が
`IS NOT DISTINCT FROM` なら素通しする。テストで見張っている。

### SQLSTATE 'GB001'
「担当者が埋まっている」専用のエラーコード。
店が満枠のとき（`P0001`）と同じにしてしまうと、
**別の担当を選べば取れる**ことにお客様が気づけない。
クライアントは `isStaffConflictError()`（`src/lib/tenantStaff.ts`）で判定する。
文言一致で判定しないのは、業種フォークがメッセージを言い換えた瞬間に静かに壊れるため。

---

## 3. スタッフの追加・削除

`supabase/migrations/20260804010000_staff_invite_code.sql`

`tenants.staff_invite_code`（16桁hex＝64bit）＋ RPC 5本。
**お客様用の `invite_code` とは別のコード。** 兼用すると
「お客様に配ったリンクからスタッフになれる」＝顧客データ全件が見える権限が漏れる。

| RPC | 権限 | 内容 |
|---|---|---|
| `get_my_staff_invite_code()` | オーナー | 未発行なら発行して返す |
| `regenerate_staff_invite_code()` | オーナー | 作り直す（古いコードは即無効） |
| `lookup_tenant_by_staff_invite_code(p_code)` | authenticated | 加入前の確認用。anon には渡さない |
| `join_tenant_as_staff_with_invite_code(p_code, p_display_name)` | 本人 | **自分の行だけ**作る。role は `'trainer'` 固定 |
| `remove_staff_member(p_user_id)` | オーナー | 自分自身・owner・customer は消せない |

加入が SECURITY DEFINER の RPC 経由なのは、RLS の
`"Users can insert own membership"` が `role='customer'` と
「自分がオーナーのテナントの owner」しか許していないため
（`20260803120000_tenant_members_write_scope.sql`。自己昇格の防止）。
**引数に user_id / role を取らない**のが要点で、取ると他人の行の作成や
owner への昇格に使える。

`join_*` は `user_roles` にも `trainer` を入れる。アプリがジム側画面を出すかどうかは
グローバルロールで決めている（`AuthContext`）ため、これが無いとスタッフとして
加入してもお客様画面のままになる。なお `trainer` ロールは新規登録時に誰でも選べる
（＝自分で取れる）ので、ここで付与しても権限は増えない。
**実際のジムへの所属は `tenant_members` が決める。**

`remove_staff_member` は担当していた予約を消さず `staff_user_id = NULL` に戻す。
予約ごと消すと、お客様の予約が黙って消える。

人数上限は既存の `tenants.max_trainers` ＋ `trg_enforce_tenant_member_limits`
がそのまま効く（SECURITY DEFINER でも BEFORE INSERT トリガーは走る）。

---

## 4. 画面

| 場所 | 何ができるか |
|---|---|
| お客様の予約画面 | 日付選択の前に担当を選ぶ（既定「指名なし」）。選ぶと空き枠の表示がその担当基準に切り替わる |
| ジムの予定表 → 代理予約 | 担当セレクタ。空き枠グリッドも担当基準 |
| ジムの予定表 → 予約カード | 担当名を表示。「担当を変更」で差し替え |
| ジム設定 → スタッフ管理 | 招待コード／リンクのコピー、作り直し、一覧、削除 |
| `/join-staff/:code` | スタッフ本人が参加するページ |

**担当セレクタはスタッフが2人以上のときだけ出す**（`canSelectStaff()`）。
一人ジム（Salute御所南など）には無用な一手を足さない。
スタッフ管理カードはオーナー以外には何も描画されない
（RPC が null を返す＝カードごと非表示）。

表示名は `tenant_members.display_name` から引く。`profiles` はお客様から
他人の行を読めない（`profiles_tenant_scope_select`）ため。

予約の日時変更（reschedule）は担当を引き継ぐ。変更先でその担当が埋まっていれば
DB が拒否して変更自体が失敗する＝旧枠が復元されるので、担当だけ静かに外れることはない。

---

## 5. 本番DBへの適用

`*.supabase.co` はネットワークポリシーで遮断されているため、
クラウドセッションからは適用も確認もできない。手順:

1. Supabase ダッシュボード → SQL Editor に
   `20260804000000_booking_staff_assignment.sql` →
   `20260804010000_staff_invite_code.sql` の順で貼って実行
2. `node scripts/check-schema-applied.mjs > /tmp/check.sql` の中身を貼って実行。
   **0行なら適用漏れ無し。**

### 2026-08-04 の適用実績（本番 rrbfwitprzuevzytykrq）

**Lovable の Publish はマイグレーションを流さなかった。** Publish 済みの状態で確認して、
`bookings.staff_user_id` も `tenants.staff_invite_code` も関数8本もトリガー2本も
1つも入っていなかった。Lovable MCP の `query_database` から手で適用した。

- 接続先の確認は `tenants` に Salute御所南（`ceda19b0-…`）が居ることで行う
- 1本ずつ `BEGIN; … COMMIT;` で囲む。2本目は上記の 42883 で落ちたが、
  **トランザクションのおかげで中途半端に残らずロールバックされた**
- 適用後: 87 テーブル / 801 カラム = types.ts の期待値と完全一致。**他の取り残しは無かった**

**Publish に任せきりにしない。** 適用したつもりで入っていない状態が、いちばん危ない。

### ⚠️ search_path を固定した関数から pgcrypto を呼ぶときは extensions を足す

2026-08-04 の本番適用で実際に踏んだ:

```
ERROR 42883: function gen_random_bytes(integer) does not exist
```

`gen_random_bytes` は pgcrypto の関数で、Supabase では **public ではなく
`extensions` スキーマ**にある。SECURITY DEFINER 対策で `SET search_path = public`
を付けると、そのままでは解決できない。`SET search_path = public, extensions` にする。

既存の `tenants.invite_code` は列 DEFAULT で `gen_random_bytes` を使っていて動くため
（search_path を固定していない）、「使えるはず」と思い込んで踏んだ。

**マイグレーションは適用して初めて落ちる。** tsc もテストもビルドも緑のまま素通りする。
`src/test/staffAssignment.test.ts` が全マイグレーションを走査して見張るようにした。

### 適用前でも従来どおり動くようにしてある
コミット済み＝本番DBに適用済み、ではない（`mem/ops/schema-drift.md`）。
**PostgREST は存在しない列を名指しした瞬間にリクエストごと拒否する**ので、
新しい列を無条件に payload / select へ入れると、適用までの間
「担当を使っていない店の、ごく普通の予約」まで全部落ちる。

- `createBooking` … `staff_user_id` は**担当を指名したときだけ** payload に入れる。
  無条件に入れると `PGRST204` で**すべての予約作成**が拒否される。
- `rescheduleBooking` … 列を明示列挙せず `select("*")` を使う。
  列挙に混ぜると `42703` で**すべての予約変更**が失敗する。
- `get_my_staff_invite_code` が無い状態では null が返り、スタッフ管理カードごと出ない。

どちらも `src/test/staffAssignment.test.ts` が見張っている（変異テスト済み）。

残る差分は「`get_tenant_booked_slots` が `staff_user_id` を返さないので、
担当を選んでも空き枠が担当基準にならない」ことだけ。**適用は必須。**

---

## 6. 体験予約（trial_bookings）に担当が無い理由

公開ページから誰でも入れる枠で、指名の概念が無いため列を足していない。
店全体の枠は1件として消費するが、担当者単位の判定には効かない。
体験のあと会員になった人の予約からは担当を選べる。
