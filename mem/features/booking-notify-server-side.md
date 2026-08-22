# 予約通知のサーバー側移行（booking_notify_log / notify-new-booking）（2026-08-21）

「お客様が予約を入れてもジム側に通知（メール・プッシュ）が届かないことがある」の
根本対応。**予約の通知を、お客様の端末発からサーバー側（DBトリガー起点）へ移した。**

## 診断の要約（30仮説 → 反証を生き延びたのは8件）

- 症状: 予約は入り、**お客様への確認メールは届くのに、店宛だけが消える**
  （8/8・8/15・8/20 の3件。全件が自己予約。代理予約では一度も起きていない）。
  逆パターン（店宛は届き、お客様宛だけ消える）も4件。
- 決め手は **email_send_log の時刻分析**: 正常時は「店宛→お客様宛」の順で、
  お客様宛は予約から最短 3.14 秒。消えた3件のお客様宛は **2.6〜3.0 秒**＝
  「1通目」の位置。**店宛の invoke はそもそも呼ばれていない**（弾かれたのではない）。
- 原因: 通知は端末発（旧 src/lib/bookingNotification.ts）。送信前に
  `fetchMyTenantId()` → `supabase.auth.getUser()` が**毎回 /auth/v1/user へ GET**
  （リトライ無し・失敗しても throw せず null）→ `if (trainerId)` が false →
  **console.warn だけ残して黙って消える**。確認メールはこの解決を通らないので届く。
- **お客様がプッシュ通知をオフにしていても店側には無関係**（当初の疑いは否定）。
- 同型の前例: メッセージ通知（2026-08-11 に notify_new_message でサーバー側へ移行）。

## 実装（20260821090000_booking_notify_server_side.sql ＋ notify-new-booking）

```
bookings AFTER INSERT (notify_booking_created)
  → booking_notify_log に記録（actor_user_id = auth.uid()）
  → net.http_post → notify-new-booking（x-cron-secret、body は booking_id/log_id だけ）
      → 店宛メール（new-booking-notification / _resolve_trainer_）
      → お客様宛の受付確認（booking-confirmation / _resolve_user_・gymNote 込み）
      → プッシュ（自己予約のみ。スタッフ全員＋本人。10分窓で定期予約を1回に畳む）
      → booking_notify_log.dispatched_at / last_error を更新
```

- **トリガーは EXCEPTION で全部握りつぶす**（通知の失敗が予約を巻き添えにしない）
- vault の `project_functions_url` / `cron_secret` を使う（メッセージ通知と同じ。
  **追加の vault 設定は不要**）。🔴 service_role キーを Bearer に載せる方式は
  環境変数と一致せず 403（20260812040000 で実際に踏んだ）
- `booking_notify_log` は service_role 専用（RLS有効・ポリシー無し・REVOKE）。
  **dispatched_at が NULL の 'created' 行＝消えた通知**が SQL 1本で見える
- 削除（removed）・同日消化（forfeited）も採取（将来キャンセル通知を移す材料）
- delete_my_gym に DELETE を追加。🔴 **bookings の後に置く**（AFTER DELETE トリガーが
  'removed' 行を足すため。前に置くと行が残る）

## 🔴 旧クライアントとの共存（冪等キーを変えるな）

公開済みの旧アプリは今までどおり端末からも送ってくる。

- **メール**: send-transactional-email に notification_dedupe による重複排除を追加
  （キー `email:<idempotencyKey>`、INSERT の 23505 で先勝ち判定）。サーバーと旧アプリは
  **同じキー**（`booking-notify-<id>` / `booking-confirm-customer-<id>`）を名乗るので
  1通に畳まれる。🔴 このキー文字列は旧アプリのビルドに焼き込まれている。**変えると
  移行期間中ずっと二重送信になる**（bookingNotifyServerSide.test.ts が固定）
  - 予約（dedupe キーの INSERT）は **enqueue の直前**に置く。前段の失敗パスが後に
    残っていると、一時エラーでキーだけ焼けて「永久に duplicate」になる
- **プッシュ**: タグを旧アプリと同じ `booking-<id>` に。Web は置き換えで1件になるが、
  **ネイティブは畳めない**（sendFcm はタグを data にしか入れない）。旧アプリの更新までは
  店の端末で二重に鳴りうる（メッセージ通知の移行時と同じ割り切り）
- **予約変更**: 変更は「削除→INSERT」なので、新クライアントは内部 INSERT に
  `created_via='reschedule'` を付けて「新規予約」通知を抑止（店には従来どおり
  「予約日時の変更」プッシュが届く）。**旧クライアントの変更は付けられない**ため、
  旧アプリからの変更では新規予約メールが届きうる（過渡期のみ・実害小と判断）

## ついでに塞いだ観測の穴

- send-transactional-email の早期 return（認可403・宛先解決失敗・テンプレート404）が
  **email_send_log に1行も残さなかった** → status='rejected' で記録するようにした
  （401 では書かない: anon キーで叩ける入口なので無制限の書き込み経路になる）。
  status の CHECK に 'duplicate' / 'rejected' を追加
- `fetchMyTenantId` の `getUser()` → `getSession()`（localStorage 読み。残っている
  端末発の経路＝キャンセル通知・チャット等もこれで失敗しにくくなる）

## 残作業・既知の制約

- **キャンセル通知はまだ端末発**（useBookings の sendCancel*）。同じ沈黙故障が
  起きうる。booking_notify_log に removed/forfeited は採れているので、
  次はこれを notify-new-booking 方式に寄せる
- クライアント側の変更（端末発送信の削除・getSession 化）は **Lovable の Publish と
  次のネイティブビルドが出るまでお客様の端末に届かない**。それまでは
  「サーバー＋旧経路」の並走（メールは dedupe で1通、プッシュは二重がありうる）
- 帯域: 定期予約は1行ごとに店宛メールが出る（従来と同じ）。プッシュは10分窓で1回

## 本番適用（2026-08-21 完了）🔴 順番に意味がある

1. マージ → Lovable が同期（read_file でレビュー修正込みのコードを確認）
2. **send-transactional-email → notify-new-booking の順でデプロイ**
   （dedupe が無いまま 3 を先にやるとサーバー＋旧クライアントの二重メールになる）
3. migration を適用（この瞬間からトリガーが動き出す）
4. 3段構えの検証

適用済み。検証の結果:

| # | 確認 | 期待 | 結果 |
|---|---|---|---|
| 1 | 両関数のデプロイ（DBから net.http_post で叩く） | 404 以外 | notify-new-booking=403（対照の notify-new-message と同一）/ send-transactional-email=401 |
| 2 | お客様を演じた実 INSERT（BEGIN…ROLLBACK） | 記録簿に1行 | event=created / actor=お客様本人 / skip なし / http_request_id 有り |
| 3 | pg_net に積まれた中身 | 秘密ヘッダ＋ID だけ | url=/notify-new-booking・x-cron-secret 有り・body は `{log_id, booking_id}` のみ |
| 4 | ROLLBACK 後の残留 | 0件 | 記録簿0 / 予約0 / キュー0 |
| 5 | **トリガーと同じ URL・同じ秘密**で関数を叩く | 200 | `{"skipped":"booking_not_found"}`（＝認可が通り、ロジックも動く） |
| 6 | delete_my_gym の DELETE 対象 | リポジトリと一致 | **32テーブル完全一致**・booking_notify_log は bookings の後 |
| 7 | 権限 | service_role 専用 | authenticated / anon とも記録簿は読めず、3関数とも EXECUTE 不可 |
| 8 | email_send_log の CHECK | 10値 | duplicate / rejected / rate_limited を含む |

### ✅ 実トラフィックで完全確認（2026-08-22）

適用時に唯一残していた「関数 → 実際にメールが届く」を、**本物の予約で確定**させた
（合成テストは `on_booking_ensure_customer` がオーナーに customer ロールを足すため見送っていた）。

8/22 の実予約3件（うち **10:37 はお客様の自己予約＝まさに壊れていたケース**）:

- `booking_notify_log`: 3件とも `dispatched_at` 入り・`skip_reason` / `last_error` なし
- `email_send_log`: 3件とも **店宛（new-booking-notification）と お客様宛
  （booking-confirmation）の両方が pending → sent**
- 各予約に `duplicate` が1組ずつ＝**旧クライアントも送ってきて、dedupe が1通に畳んだ実証**
  （設計どおり。移行期間の二重送信は起きていない）
- 18時間の集計: **sent 41 / pending 41（完全に1:1）・duplicate 6・rejected 0・failed 0**

⚠️ 体験・ドロップインの店宛通知も同じ `new-booking-notification` テンプレートを使うが、
冪等キーが枠ベースなので **dedupe の対象外**（`DEDUPE_KEY_PREFIXES` で除外済み）。
8/22 の体験2件は重複排除されずに正しく送られており、**マージ前に直した判断が
本番で裏付けられた**（キャンセル→同枠再予約で確認メールが永久に消える穴を回避）。

⚠️ 適用中、`query_database` の 499 に3回当たった。うち1回は
**「無い」と確認した直後に再実行したら 42710（既に在る）**＝ mem の記録どおり
**遅れて適用されていた**。499 のあとは間を置いて状態を見ること。
DDL は小さく分けて送ると通りやすい（bookings への DROP TRIGGER を含む文が落ちやすい）。

## 副産物: バウンスで配信停止になっている宛先が1件（2026-08-22 発見）

`email_send_log` の集計中に `status='bounced'`（Permanent bounce）が1件見つかった。
その宛先は **`suppressed_emails` に載っている＝今後すべてのメールが黙って止まる**。
アカウントは存在するが profiles.display_name が空・これまで届いたメールは1通だけ、
という状態（登録途中で離脱した可能性が高い）。
実害が出るのは「実在のお客様なのにアドレスが死んでいる」場合＝予約確認が永久に
届かないので、**心当たりのあるお客様がいたらアドレスを直して
`suppressed_emails` から削除する**こと。今回の移行とは無関係の既存事象。

## 診断で分かったが今回は直していないもの

- 逆パターン4件（お客様宛だけ消える）は今回の移行で同時に解消（確認メールも
  サーバー発になったため）
- 酒本さんの件の100%確定には、届いた確認メールの**差出人名**（「Salute御所南」で
  なく「ジムボード」なら getUser 失敗の証拠）と、本人への「新しい予約」プッシュの
  有無が使える（DB には残っていないため受信箱でしか確認できない）

## レビューで見つけて直した5件（2026-08-21・マージ前）

反証つきレビュー（9指摘 → 2件確定＋自己検証で3件追加）。

1. 🔴 **重複排除を全キーに効かせてはいけない**（confirmed・major）。
   `notification_dedupe` に期限は無く、一度焼けたキーは二度と送れない。体験・
   ドロップインの冪等キーは `trial-confirm-<日時>-<連絡先>`＝**予約行ではなく
   「枠×連絡先」**で決まるので、「キャンセル → 同じ枠を取り直す」で確認メールが
   永久に消える（体験のお客様はアプリを持たず、メールが唯一の連絡手段）。
   → `DEDUPE_KEY_PREFIXES = ['booking-notify-', 'booking-confirm-customer-']` に限定。
   **ここに足すキーは、必ず予約行の id を含むものに限ること。**
2. 🔴 **予約変更で予約が消える**（自己検証。未適用DBでの schema drift）。
   reschedule は「旧行を削除 → 新行を INSERT」で、その INSERT は必ず silent＝
   `created_via` を積む。未適用のDBでは PGRST204 で拒否され、**ロールバックの
   再作成も同じ経路なので道連れ**＝お客様の予約が消える。staff_user_id 方式
   （値があるときだけ積む）が使えない唯一の列だった。→ PGRST204 のときだけ
   列なしで1回入れ直す。
3. プッシュの抑止が **select → upsert** で、定期予約の N 本が同時に走ると全員が
   「行が無い」を見て N 回鳴る。→ INSERT の一意制約で直列化（23505 で判定。
   10分より古ければ鳴らし直す。基盤エラーは fail-open で鳴らす）。
4. `staffRes.error` を見ておらず、**一過性のDBエラーが「スタッフ0人」に化けて
   店宛メールが黙って落ちる**（＝直したはずの沈黙故障をサーバー側で再発させる）。
   → throw して last_error に残す。
5. `tenant_plans` に (tenant_id, plan_name) の**一意制約が無い**のに maybeSingle。
   同名プラン2件で所要時間が既定60分に化け、メールの終了時刻がずれる。→ limit(1)。

ついでに: `email_send_log` の CHECK に `rate_limited` を追加（process-email-queue が
429 のときに書こうとして 23514 で無音に落ちていた**既存バグ**。制約を作り直す機会に修正）。

反証で否定した主なもの: 「EXCEPTION が booking_notify_log ごと巻き戻すので痕跡ゼロ」
（vault 欠落は例外にならず skip_reason が残る／pg_net の enqueue はトランザクショナルで
実際の故障は dispatched_at NULL として残る）。
