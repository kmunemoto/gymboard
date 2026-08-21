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

## 本番適用の順序（🔴 順番に意味がある）

1. マージ → Lovable が同期
2. **send-transactional-email を先にデプロイ**（dedupe が無いまま 3 を先にやると
   サーバー＋旧クライアントの二重メールになる）→ notify-new-booking をデプロイ
   （どちらも Lovable のエージェント経由のみ。push/Publish では出ない）
3. migration を適用（この瞬間からトリガーが動き出す）
4. 3段構えの検証（お客様を演じた実 INSERT → booking_notify_log と
   net.http_request_queue を確認 → ROLLBACK。※ROLLBACK すれば http_post も
   キューごと消えるので本物のメールは飛ばない）

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
