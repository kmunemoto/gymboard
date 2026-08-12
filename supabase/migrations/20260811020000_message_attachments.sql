-- メッセージに画像・動画を添付できるようにする（2026-08-11）
--
-- パーソナルジムのチャットで一番やり取りしたいのはフォーム動画と食事写真。
-- いまはテキストしか送れないので、そこだけ LINE に逃げている。
--
-- ## 置き場所と見える範囲
--
-- バケット `message-attachments` は**非公開**。パスは `<sender_id>/<uuid>.<ext>`。
--
-- 読めるのは2者だけ:
--   ・送った本人（フォルダ名が自分の user_id）
--   ・**そのファイルを参照するメッセージの受信者**
--
-- 「同じテナントなら読める」にはしない。それだと**同じジムの別のお客様**が
-- 他人の会話の添付を読めてしまう（パスが推測困難なだけ、という状態になる）。
--
-- ⚠️ アップロードはメッセージ行の INSERT より**先**に起きる。その瞬間はまだ
--    参照する行が無いので、送信者はフォルダ所有で読む（下の1本目の OR）。

-- ── 1. messages に添付の列を足す ────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_path TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT;

COMMENT ON COLUMN public.messages.attachment_path IS
  'message-attachments バケット内のパス。<sender_id>/<uuid>.<ext>';
COMMENT ON COLUMN public.messages.attachment_type IS
  '''image'' か ''video''。表示の出し分けにだけ使う';

-- 種別は2つだけ。増やすときはクライアント側の描画も一緒に増やすこと。
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_type_known;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_type_known
  CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'video'));

-- パスと種別は必ずセット。片方だけ入ると描画できない行になる。
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_pair;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_pair
  CHECK ((attachment_path IS NULL) = (attachment_type IS NULL));

-- 本文が空でも、添付があれば送れる（写真だけ送る、が自然な操作なので）。
-- 逆に**どちらも無い行**は作らせない。
--
-- ⚠️ NOT VALID にしてある。既存行を検査しないので適用が失敗しない。
--    新しい INSERT/UPDATE には**そのまま効く**（NOT VALID は既存行を見ないだけ）。
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_or_attachment;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_or_attachment
  CHECK (btrim(content) <> '' OR attachment_path IS NOT NULL) NOT VALID;

-- ストレージのポリシーが attachment_path で messages を引くので、索引を張る。
CREATE INDEX IF NOT EXISTS messages_attachment_path_idx
  ON public.messages (attachment_path)
  WHERE attachment_path IS NOT NULL;

-- ── 2. 非公開バケット ───────────────────────────────────────────────
--
-- 大きさと形式は**サーバー側で**縛る。クライアントの検査だけだと、
-- 直接 API を叩かれたときに何でも置ける置き場になる。
--
-- 25MB は「フォーム確認の短い動画」を想定した上限。ジム1軒あたりの保管量が
-- 効いてくるので大きくしすぎない。上げるならストレージ費用と一緒に判断すること。
-- 画像はクライアントで JPEG に変換してから上げるので image/jpeg だけで足りるが、
-- 変換前に落ちる経路もありうるので png/webp も許す。
-- video/quicktime は iPhone の .mov。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  26214400,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3. ストレージの RLS ─────────────────────────────────────────────
DROP POLICY IF EXISTS "message attachments: participants can read" ON storage.objects;
CREATE POLICY "message attachments: participants can read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (
    -- 送った本人（アップロード直後、まだ参照する行が無い瞬間もここで読める）
    auth.uid()::text = (storage.foldername(name))[1]
    -- そのファイルを添付したメッセージの受信者
    OR EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.attachment_path = storage.objects.name
         AND m.receiver_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "message attachments: sender can upload" ON storage.objects;
CREATE POLICY "message attachments: sender can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "message attachments: sender can delete" ON storage.objects;
CREATE POLICY "message attachments: sender can delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
