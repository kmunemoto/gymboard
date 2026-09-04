-- ブロック枠に用事名を書けるようにする（2026-09-04 宗本さんの要望）
--
--   「ブロックの用事をもちろんお客様には見せません。
--     お店の中だけで見返せるようにしたいだけです」
--
-- ## 列は足さない
--
-- `blocked_slots.reason` は初期マイグレーション（20260411130611）からある。
-- 使われていなかっただけで、器はもうある。`useBookings` も既に読んでいた
-- （画面に出す手前で捨てていた）。
--
-- ## 🔴 いちばん大事なのは、この下の DROP POLICY
--
-- いままで `blocked_slots` は **同じジムのお客様が REST API で全列読める**状態だった。
-- 画面に出していなかっただけ。用事名に「歯医者」「面談 田中さん」と書けるように
-- するなら、ここを塞がないと「会員には見えません」が嘘になる。
--
-- 塞いでも壊れないことを本番で確認済み:
--
--   1. お客様の画面が空き時間を取る関数（get_tenant_booked_slots / get_booked_slots）は
--      **SECURITY DEFINER** で RLS を通らない。返す列は時刻と状態だけで reason は無い
--   2. `blocked_slots` を直接読むクライアントは useAllBookings の1か所だけで、
--      呼び出し元は src/components/trainer/ の3画面（予定表・ダッシュボード・稼働率）のみ。
--      お客様の画面からは1つも呼ばれていない
--   3. 全19ジムのオーナー・スタッフ**全員**が user_roles に trainer を持っている
--      （1人でも欠けていたら、その人の予定表が真っ白になるところだった）
--
-- 残る "Trainers can view blocked slots"（has_role(uid,'trainer')）に、
-- RESTRICTIVE な tenant_isolation（tenant_id = get_my_tenant_id()）が重なるので、
-- 結果は「自分のジムのスタッフだけが読める」になる。

DROP POLICY IF EXISTS "Customers can view blocked slots" ON public.blocked_slots;

-- 既存の行を掃除する。
--
-- この機能より前のクライアントは、人が名前を付ける代わりに
-- 「ブロック（14:15〜15:15）」という文字列を必ず入れていた。そのまま用事名として
-- 表示すると、狭いマスで「ブロ…」になって**いまより読めなくなる**。
--
-- 🔴 文言ではなく**形**で判定する（5言語ぶんある。ja/en/ko/zh-CN/zh-TW）。
-- 🔴 `created_at` で時点を切る。これが無いと、再適用したときに
--    **人が付けた用事名まで消す**（「掃除（10:00〜11:00）」のような書き方をされたとき）。
UPDATE public.blocked_slots
   SET reason = NULL
 WHERE reason ~ '^[^[:space:]]{1,12}[[:space:]]*[（(][[:space:]]*[0-9]{1,2}:[0-9]{2}[[:space:]]*[〜~–—-][[:space:]]*[0-9]{1,2}:[0-9]{2}[[:space:]]*[)）]$'
   AND created_at < '2026-09-05T00:00:00+09:00';

-- 長さの上限。
--
-- 🔴 アプリの入力欄は20文字だが、**DB は30にする**（わざと違う）。
--    出回っている古い版は自動生成の文字列を書き続ける。英語だと
--    `Block (14:15–15:15)` で19文字あり、20にすると文言を1文字足しただけで
--    **古い端末のブロック作成が黙って失敗する**。出荷済みの版に対して DB を厳しくしない。
ALTER TABLE public.blocked_slots DROP CONSTRAINT IF EXISTS blocked_slots_reason_len;
ALTER TABLE public.blocked_slots
  ADD CONSTRAINT blocked_slots_reason_len
  CHECK (reason IS NULL OR char_length(reason) <= 30);

COMMENT ON COLUMN public.blocked_slots.reason IS
  'ブロック枠の用事名（「面談」「掃除」など）。NULL なら名前なし。'
  '🔴 店内だけのもの。お客様には SELECT ポリシーごと見せない。'
  'お客様の空き枠表示は SECURITY DEFINER の RPC 経由で、この列を返さない。';
