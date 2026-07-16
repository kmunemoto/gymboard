# お客様⇔ジムのチャット（messages テーブル）

## 概要
`useMessages.ts`（`sendMessage` / `useMessages` / `useUnreadCount` / `useUnreadBySender`）
が唯一の実装。お客様側は `CustomerChat.tsx`、トレーナー側は `TrainerMessages.tsx` と
`TrainerClientDetail.tsx`（顧客詳細のチャットタブ）の**3箇所**が呼び出し元。
`sendMessage` の挙動を変えるときは3箇所すべてを確認すること。
`messages` テーブルは Realtime publication に登録済み（`ALTER PUBLICATION supabase_realtime
ADD TABLE public.messages`）。SELECT RLS は `sender_id`/`receiver_id` が自分、または
`has_role(trainer)` なら閲覧可。

## 2026-07: 「お客様が送っても自ジムに届かない」不具合の修正

### 原因1: 送信先解決がテナント横断だった（#141）
`CustomerChat.tsx` が送信先を `get_trainer_ids()[0]` で決めていた。この関数は
`user_roles` を**全テナント横断**で返すため、先頭が別ジムのトレーナーになり得る。
結果、`messages.receiver_id` が別ジム宛になり、自ジムの受信一覧
（`receiver_id = 自分` で読む）にも未読カウントにも現れなかった。
→ `tenantHelper.fetchMyTenantTrainerId()`（自テナントの trainer優先→owner）に置換。

### 原因2: 解決・送信の失敗が無言で握りつぶされていた
上記1に加えて、**そもそも送信先解決やINSERTが失敗しても、画面には何も表示されず
「正常に動いているように見える空チャット」のままだった**点が実害を大きくしていた。

- `CustomerChat.tsx` の送信先解決（`fetchMyTenantTrainerId()`）が null を返しても
  （テナント未所属・所属が非active等）、ヘッダーは既定の「コーチ」表示のまま、
  チャット欄も空のまま、エラーも出ない。
- `handleSend` は `!trainerId` で無言 return。送信ボタンを押しても何も起きない。
- `useMessages.sendMessage` は `.insert()` の結果（`error`）を一切見ておらず、
  `withTenant()` がテナント未所属で例外を投げても呼び出し元に伝わらず、
  そのまま握りつぶされていた。

**症状の見分け方**: チャットのヘッダーが `customerChat.defaultTrainer`（既定値「コーチ」）
のまま実名に変わらない場合、送信先解決が失敗している合図（`resolvingTrainer` が
false になった後も `trainerId` が null）。

**対処**:
- `CustomerChat.tsx`: `resolvingTrainer` state を追加し、解決失敗時
  （`!resolvingTrainer && !trainerId`）は「担当トレーナーが見つかりません」の
  明示的なエラー画面に差し替える（無言の空チャットにしない）。
- `handleSend`（Customer/Trainer 両方）: `sendMessage` を try/catch し、失敗時は
  toast でエラー表示する。
- `useMessages.sendMessage`: `.insert().select().single()` の結果を見て、
  `error` があれば `throw`（呼び出し元が catch できるように）。

### 原因3（付随的改善）: 送信者本人への表示が Realtime の往復頼みだった
`sendMessage` は INSERT 後にローカル state へ何も追加せず、Realtime の
`postgres_changes` INSERT イベントが返ってくるのを待つだけだった。Realtime の
購読が確立前・瞬断中だと、**送った本人の画面にすら表示されない**タイミング窓があった。
→ INSERT の戻り値（`.select().single()`）をその場でローカル `messages` state に
即時追加するよう変更。Realtime 側のハンドラにも `id` 重複チェックを追加し、
ローカル即時反映と Realtime の二重追加を防いでいる。

## 落とし穴
- 新しく「ジム側スタッフ宛に何か送る」処理を書くときは、必ず
  `tenantHelper.fetchMyTenantStaffIds()` / `fetchMyTenantTrainerId()` を使うこと
  （`get_trainer_ids()` はテナント横断なので使わない）。
- `sendMessage` は今後もエラーを握りつぶさない（`throw` する）実装を維持すること。
  呼び出し側は必ず try/catch し、ユーザーに失敗を伝える。
- 「解決できない／取得できない」状態を UI 上で通常状態と見分けがつかないまま
  放置しない。今回のように、正常に見える空表示のまま実は壊れている、という
  パターンは調査コストが高く実害も気づかれにくい。
