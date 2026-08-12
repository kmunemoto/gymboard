# アプリ内メッセージ（チャット）

お客様とジムの1対1チャット。`messages` テーブル1本の素朴な作りで、
`CustomerChat`（お客様側）と `TrainerMessages`（ジム側）が同じ `useMessages` を使う。

| ファイル | 役割 |
|---|---|
| `src/hooks/useMessages.ts` | 取得・送信・既読・Realtime。未読数（全体／送信者別）も同居 |
| `src/components/customer/CustomerChat.tsx` | お客様側。相手は自テナントの代表スタッフ1名 |
| `src/components/trainer/TrainerMessages.tsx` | ジム側。会話一覧＋チャット |
| `supabase/functions/notify-new-message/` | 新着のプッシュ通知（サーバー側） |
| `src/test/messagingBasics.test.ts` | 表示の嘘・在籍・N+1 を見張る |
| `src/test/messageNotification.test.ts` | 通知の経路を見張る |

---

## 🔴 2026-08-11 の棚卸しで見つかったもの

動いてはいたが、**画面が事実と違うことを3つ言っていた**。どれも
「エラーが出ないまま間違ったものを表示する」型で、使っていても気づけない。

### 1. 「オンライン」が常に緑だった

`CustomerChat` のヘッダーはプレゼンスを**一切見ずに**固定で「オンライン」を出していた。
深夜に送ったお客様が「オンラインなのに返事が来ない」と感じる。
実プレゼンスを作るほどの価値は無いと判断し、**表示ごと削除**（ロケールキーも5言語から）。

### 2. 既読が送信者に永久に届かなかった

`read` カラムも Realtime も**元からあった**のに、`useMessages` の購読が
**INSERT だけ**だったので、相手が読んでも送信者の画面は変わらなかった。
UPDATE の購読を足して初めて「既読」を出せるようになった。

```
症状: DB には read=true が入っている。相手の画面も正しい。送信者だけ知らない。
```

`markAsRead` は `messages` が変わるたびに呼ばれるので、**未読が無いときは
書きにいかない**ガードも入れた（毎回0行 UPDATE の往復が出ていた）。

### 3. 退会したお客様が会話相手に並び続けていた

`TrainerMessages` は `user_roles` を `role=customer` で引いていた。
`user_roles` は**全テナント横断**でロールを持つだけのテーブルで、**在籍状態を持たない**。
2026-08-10 に入れた退会・休会がここに一切効いていなかった。

`tenant_members` を `tenant_id` ＋ `status IN ('active','suspended')` で引く形に統一。
**休会は残す**（休会にした瞬間に消えるのは「休会」ではなく「消滅」）。

### おまけ: 会話プレビューが N+1 だった

顧客1人につき1クエリを**直列で**回していた。30人なら30往復。
自分が関わるメッセージを新しい順に1回引き、相手ごとの先頭を採る形にした。
遡る上限は `LAST_MESSAGE_SCAN_LIMIT`。

---

## 🔴 通知は「送信者の端末」から投げてはいけない（2026-08-11）

以前は `sendMessage` の中で LINE とプッシュを fire-and-forget していた。
つまり**送信者の端末が通知を投げていた**ので:

- 送信直後にアプリを閉じる／画面を切り替える／電波が切れる → **通知が飛ばない**
- 失敗しても `console.error` だけ。**送った本人にも受け取る側にも分からない**

メッセージは DB に入っているので「送れている」。でも相手は気づかない。
**同じ日に altool でも「緑なのに届いていない」を踏んでいる。同じ型の壊れ方。**

### いまの経路

```
messages に INSERT
   ↓ AFTER INSERT トリガー notify_new_message()
   ↓ net.http_post（vault の URL と service_role キー）
notify-new-message（Edge Function）
   ↓ message_id で実物を読み直す
send-push-notification
```

**行が入った時点で確定する**ので、そのあと端末がどうなっても通知は飛ぶ。

### 設計上、外してはいけない点

| 決めたこと | 外すとどうなるか |
|---|---|
| トリガーは `EXCEPTION WHEN OTHERS` で握りつぶし `RETURN NEW` | Edge Function が落ちた日に**チャットごと使えなくなる**。通知は「あったほうがいいもの」、メッセージ本体は「絶対に落とせないもの」 |
| vault が未設定でも素通り | 適用直後・兄弟アプリで**メッセージが送れなくなる** |
| Edge Function は `message_id` **だけ**を受け取る | タイトルや本文を受け取ると、この入り口を叩ける相手が**任意の内容の通知**を作れる |
| `notification_dedupe` で冪等化 | トリガーの再実行で二重に鳴る |
| 送信に失敗したら冪等キーを**消す** | 一度失敗したメッセージは**二度と通知できなくなる** |
| クライアントに通知を書き戻さない | サーバー側と合わせて**二重に鳴る** |

### 🔴 project ref を焼き込まないこと

呼び先 URL を `https://<ref>.supabase.co/...` と直書きすると、**兄弟アプリが
このマイグレーションをコピーした瞬間、そのジムの通知がジムボードのプロジェクトに飛ぶ。**

これは仮の話ではない。**既存のマイグレーション6件が既にそうなっている**
（うち3件はジムボード以外の ref を向いている）。URL も鍵も vault から読むこと。
`messageNotification.test.ts` が「これ以上増やさない」ための見張りをしている。

### 適用後にやること

vault に2つ入れる（値はリポジトリに書かない）:

```sql
select vault.create_secret('https://<自分のref>.supabase.co/functions/v1',
                           'project_functions_url');
-- service_role キーは既存の 'email_queue_service_role_key' があればそれを使う。
-- 無ければ 'service_role_key' で入れる（そちらが優先される）。
```

どちらか欠けていると通知は飛ばないが、**メッセージの送受信は普通に動く**。

### LINE は引き継いでいない

クライアント側には LINE 送信もあったが、`LINE_INTEGRATION_ENABLED = false` なので
**実際には何も送っていなかった**（`src/lib/lineNotify.ts` の冒頭に理由と再開条件）。
復活させるときは、クライアントではなく `notify-new-message` に足すこと。
