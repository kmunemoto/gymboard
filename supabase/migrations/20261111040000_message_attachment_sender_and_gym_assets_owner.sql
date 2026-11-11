-- ============================================================================
-- チャットの添付は「上げた本人が送ったメッセージ」の受信者だけが読める・ジムのロゴの書き込みからインストラクターを外す（2026-11-11）
-- ============================================================================
-- 宗本さん「全部直すで」（2026-11-10 の定期点検）。指摘 message-attachments-1・gym-assets-limited-staff-1（いずれも low）。
--
-- ■ 何が起きていたか
-- 1. チャットの添付（非公開の置き場 message-attachments。パスは <送り主の user_id>/<uuid>.<拡張子>）の読み取りは
--    「フォルダの持ち主」または「その添付を指すメッセージの受信者」。後半が見るメッセージの行は、読む本人が作れた
--    （attachment_path の形や送り主を見る制約が無い）。スタッフ（インストラクターを含む）は共有受信箱でジムの全会話の
--    添付のパスを読めるので、自分宛てのメッセージを1行作り、attachment_path にお客様の添付のパスを入れれば、
--    お客様がオーナーに送った食事写真・フォーム動画に署名付き URL を出せた。外されたあとでも、自分のジムを開けば同じ手が使えた。
-- 2. ジムの画像（公開の置き場 gym-assets）の書き込み・差し替え・削除は「そのジムのオーナーかトレーナー」で、
--    インストラクター（制限付きスタッフ）を外していなかった。ロゴは公開の体験予約ページとお客様のアプリに出るので、
--    インストラクターが API で差し替え・削除できた（画面には出していない。お知らせの画像は外している）。
--
-- ■ 直し方
-- 1. "message attachments: participants can read" の受信者の枝に「そのメッセージの送り主＝添付のフォルダの持ち主」を足す
--    （本番の定義を写して1つ足す）。自分で作れる行（送り主＝自分）では、自分のフォルダのものしか読めなくなる。
--    正規のやり取り（送り主が自分のフォルダに上げて送る）は今まで通り読める。
-- 2. messages に CHECK messages_attachment_path_shape: attachment_path は「送り主のフォルダ/<uuid>.<jpg|png|webp|mp4|mov>」だけ。
--    アプリはどの版でも <senderId>/<crypto.randomUUID()>.<拡張子> に上げてそのパスを入れている（src/lib/messageAttachment.ts）。
--    本番の添付5件は全部この形（2026-11-11）。NOT VALID で入れてから確かめる（合わない行があれば適用が止まる）。
-- 3. gym-assets の INSERT・UPDATE・DELETE の3本に AND NOT is_limited_staff(...) を足す（本番の定義を写す）。一覧（SELECT）は残す。
--    ロゴを上げ下げする画面（TrainerGymSettings）はオーナーにしか出さないので、アプリの動きは変わらない。
--
-- 見張り: src/test/messageAttachmentSenderAndGymAssets.test.ts
-- ============================================================================

-- 1. チャットの添付の読み取り
DROP POLICY IF EXISTS "message attachments: participants can read" ON storage.objects;
CREATE POLICY "message attachments: participants can read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (
    -- 送った本人（アップロード直後、まだ参照する行が無い瞬間もここで読める）
    auth.uid()::text = (storage.foldername(name))[1]
    -- そのファイルを添付したメッセージの受信者。🔴 そのメッセージの送り主＝添付を上げた人（フォルダの持ち主）に限る
    --    （読む本人が作った行では満たせない。2026-11-11 点検 message-attachments-1）
    OR EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.attachment_path = storage.objects.name
         AND m.receiver_id = auth.uid()
         AND m.sender_id::text = (storage.foldername(storage.objects.name))[1]
    )
  )
);

-- 2. 添付のパスの形（送り主のフォルダ・アプリが作る名前だけ）
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_path_shape;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_path_shape CHECK (
    attachment_path IS NULL
    OR attachment_path ~ (
      '^' || (sender_id)::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4|mov)$'
    )
  ) NOT VALID;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_attachment_path_shape;

-- 3. ジムの画像（ロゴ等）… 自分のジムのフォルダに、自分のジムのオーナーだけ（インストラクターは一覧だけ）
DROP POLICY IF EXISTS "Trainers can delete gym assets" ON storage.objects;
CREATE POLICY "Trainers can delete gym assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'gym-assets'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
    AND NOT public.is_limited_staff(public.get_my_tenant_id(), auth.uid())
  );
DROP POLICY IF EXISTS "Trainers can update gym assets" ON storage.objects;
CREATE POLICY "Trainers can update gym assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gym-assets'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
    AND NOT public.is_limited_staff(public.get_my_tenant_id(), auth.uid())
  );
DROP POLICY IF EXISTS "Trainers can upload gym assets" ON storage.objects;
CREATE POLICY "Trainers can upload gym assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gym-assets'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
    AND NOT public.is_limited_staff(public.get_my_tenant_id(), auth.uid())
  );
