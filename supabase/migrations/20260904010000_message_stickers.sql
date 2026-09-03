-- チャットのスタンプ（LINE風）
--
-- 実店舗の要望（2026-09-03 宗本さん）:
--   「チャットにLINEのスタンプ機能を真似して追加したい」
--
-- ## 🔴 スタンプの絵は DB に持たない
--
-- 絵はアプリに同梱する（`src/assets/stickers/*.png`）。DB が持つのは **どれを送ったかの id
-- だけ**。理由:
--
--   - スタンプはジムボード公式のキャラクターで、**全ジム共通**（ジムごとに変えない）。
--     テナント別のテーブルもストレージも要らない
--   - 同じ絵を送るたびにアップロードしない。行に文字列が1つ入るだけ
--   - 電波が悪くてもすぐ出る（取りに行かない）
--
-- 代償: **スタンプを増やすにはアプリの更新が要る**。ジムごとに違うスタンプを持たせたく
-- なったら、そのときは `gym_videos` と同じくテナント別の表＋ストレージを足すこと。
--
-- ## 🔴 `content` にはスタンプの文字を入れる（空にしない）
--
-- 「ありがとうございます」のスタンプなら content も `ありがとうございます`。これで:
--
--   1. **古いアプリでも意味が通る。** sticker_id を知らない版は本文をそのまま表示する。
--      2026-09-03 に「古いアプリが新しい規則を知らずに詰む」を実際に踏んだばかりなので、
--      最初から素直に落ちる形にしておく
--   2. 新規メッセージの通知（`notify-new-message`）が**そのまま動く**。
--      空文字にすると、プッシュもメールも本文が空で届く
--   3. 会話内検索に引っかかる
--
-- ## id の形だけを縛る（一覧は縛らない）
--
-- どの id が存在するかはアプリ側の一覧（`src/lib/stickers.ts`）が持つ。DB に一覧を
-- 持たせると、スタンプを1枚足すたびにマイグレーションが要る。DB は「変な文字列が
-- 入らない」ことだけ保証する。

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sticker_id TEXT;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sticker_id_format;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_sticker_id_format
  CHECK (sticker_id IS NULL OR sticker_id ~ '^[a-z0-9_]{1,40}$');

COMMENT ON COLUMN public.messages.sticker_id IS
  '送ったスタンプの id（アプリ同梱の絵に対応）。NULL なら通常のメッセージ。'
  '絵は DB に持たない。content にはスタンプの文字が入っているので、'
  'この列を知らない古いアプリでも本文として読める。';

-- 送信取り消しでスタンプも落とす。
--
-- 🔴 最新の定義（20260812050000_message_unsend.sql）から全文を写して1行だけ足している。
--    古い版から写すと、間に入った変更を巻き戻す（このリポジトリで実際に踏んだ事故）。
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
         sticker_id      = NULL,   -- 🔴 これが無いと、取り消してもスタンプだけ残る
         unsent_at       = now()
   WHERE id = _message_id;

  RETURN v_path;
END;
$$;

COMMENT ON FUNCTION public.unsend_message(UUID) IS
  '自分が送ったメッセージを24時間以内に取り消す。本文・添付・スタンプを落とし unsent_at を立てる。'
  '添付のパスを返すので、呼び出し元がストレージからも消すこと。'
  '⚠️ すでに送信済みのプッシュ通知は取り消せない。';

REVOKE ALL ON FUNCTION public.unsend_message(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsend_message(UUID) TO authenticated;
