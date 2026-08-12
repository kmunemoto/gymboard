-- 送信取り消しと、メッセージ UPDATE の締め直し（2026-08-12）
--
-- ═══════════════════════════════════════════════════════════════════
-- 🔴 先に塞ぐ穴: 受信者が「届いた本文」を書き換えられた
-- ═══════════════════════════════════════════════════════════════════
--
-- 送信取り消しを入れるにあたって UPDATE の経路を調べたところ、
-- **既存の穴**が見つかった。本番で実際に再現している（ROLLBACK 付きで確認）:
--
--   オーナー → お客様「キャンセル料は3,000円いただきます」
--   お客様が UPDATE  →「キャンセル料は無料です」
--
-- **書き換えは通り、送った側の画面にもそう表示される。**
--
-- 原因は2つの重なり:
--   1. `authenticated` が messages の**全列**に UPDATE 権を持っていた
--   2. UPDATE ポリシー "Receiver can update read status" に **WITH CHECK が無い**
--      （USING は「自分が受信者か」しか見ない＝どの列を変えてもよい）
--
-- 名前は "read status" なのに、実際には**本文も添付も送信者IDも**変えられた。
-- 「言った / 言わない」の記録として使えない状態だった。
--
-- ## 直し方: 列単位の権限で締める
--
-- RLS では「どの列を変えたか」を書きにくい。**列レベルの GRANT** で締めるのが確実。
-- クライアントが直接 UPDATE してよいのは `read` だけ（`markAsRead`）。
-- 取り消しは下の RPC を通す。
--
-- ═══════════════════════════════════════════════════════════════════
-- 送信取り消し（24時間以内）
-- ═══════════════════════════════════════════════════════════════════
--
-- 本命は**誤爆対策**。別のお客様宛てに送ってしまったときに止められる保険で、
-- 業務アプリとしてはここが一番効く。
--
-- ⚠️ **すでに飛んだプッシュ通知は取り消せない。** LINE と同じ制約で、
--    相手の端末の通知バーに残った文言までは消せない。UI に明記すること。
--
-- ⚠️ 引用返信（`messageReply.ts`）は**文字列**で本文に入る。つまり
--    「引用されたあとに取り消しても、引用の中の抜粋は残る」。参照で持つと
--    今度は「取り消したのに枠だけ残る」ので、どちらにしても完全には消えない。
--    24時間の猶予は「引用される前に間に合わせる」ためのものでもある。

-- ── 1. 取り消しの記録 ───────────────────────────────────────────────

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS unsent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.messages.unsent_at IS
  '送信を取り消した時刻。NULL なら通常のメッセージ。'
  '取り消すと content は空になり attachment_* も外れる（行は残す）。';

-- 取り消した行は本文も添付も無くなる。既存の CHECK に引っかかるので逃がす。
--
-- ⚠️ 行ごと DELETE にしないのは、**会話から吹き出しが消えると
--    「何か言ったはずなのに無い」**という別の混乱を生むから。LINE と同じく
--    「送信を取り消しました」を残す。
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_or_attachment;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_or_attachment
  CHECK (
    btrim(content) <> ''
    OR attachment_path IS NOT NULL
    OR unsent_at IS NOT NULL
  ) NOT VALID;

-- ── 2. 🔴 直接 UPDATE できる列を `read` だけにする ──────────────────
--
-- ここが穴の本体。`authenticated` は全列に UPDATE 権を持っていた。
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (read) ON public.messages TO authenticated;

-- anon はそもそもメッセージを触らない（RESTRICTIVE な tenant_isolation でも
-- 弾かれるが、権限側でも落としておく）。
REVOKE UPDATE ON public.messages FROM anon;

-- ポリシーの名前が実態と合っていなかったので付け直す。
-- 中身（誰の行を触れるか）は変えない。**変えられる列**を上の GRANT で絞った。
DROP POLICY IF EXISTS "Receiver can update read status" ON public.messages;
CREATE POLICY "Receiver can mark read" ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = receiver_id OR public.has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (auth.uid() = receiver_id OR public.has_role(auth.uid(), 'trainer'::app_role));

-- ── 3. 取り消しの RPC ───────────────────────────────────────────────
--
-- SECURITY DEFINER。列の GRANT を迂回して content / attachment_* を落とす。
-- **送信者本人**、**24時間以内**、**未取り消し**の3つを関数の中で確かめる。

CREATE OR REPLACE FUNCTION public.unsend_message(_message_id UUID)
RETURNS TEXT   -- 消した添付のパス（無ければ NULL）。呼び出し元がストレージから消す
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.messages%ROWTYPE;
  v_path    TEXT;
BEGIN
  SELECT * INTO v_row FROM public.messages WHERE id = _message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- 🔴 送信者本人だけ。共有受信箱でも「他のスタッフの発言」は取り消せない
  --    （消したのが誰か分からなくなる。必要になったら別途決める）。
  IF v_row.sender_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_sender' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_row.unsent_at IS NOT NULL THEN
    -- すでに取り消し済み。二重に呼ばれても壊さない
    RETURN NULL;
  END IF;

  IF v_row.created_at < now() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'too_old' USING ERRCODE = 'check_violation';
  END IF;

  v_path := v_row.attachment_path;

  UPDATE public.messages
     SET content         = '',
         attachment_path = NULL,
         attachment_type = NULL,
         unsent_at       = now()
   WHERE id = _message_id;

  RETURN v_path;
END;
$$;

COMMENT ON FUNCTION public.unsend_message(UUID) IS
  '自分が送ったメッセージを24時間以内に取り消す。本文と添付を落とし unsent_at を立てる。'
  '添付のパスを返すので、呼び出し元がストレージからも消すこと。'
  '⚠️ すでに送信済みのプッシュ通知は取り消せない。';

REVOKE ALL ON FUNCTION public.unsend_message(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsend_message(UUID) TO authenticated;
