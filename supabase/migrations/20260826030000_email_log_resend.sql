-- 通知の再送に必要な材料を残す（2026-08-26）
--
-- 送信履歴（20260826010000）で「届かなかった」ことは分かるようになったが、
-- **もう一度送る手段が無かった**。履歴が持っているのは種別・宛先・状態だけで、
-- メールを組み立て直す材料（お客様の名前・日時・プラン）を残していない。
-- 描画済みのメールはキュー（pgmq）が送信成功時に消す。
--
-- そこで `send-transactional-email` が受け取った `templateData` をそのまま残す。
-- 再送は「保存した材料でもう一度描画して送る」＝**同じ内容が届く**。
--
-- ⚠️ 中身にはお客様の名前・予約日時が入る。RLS は履歴と同じ（そのジムのスタッフだけ）。
--    画面はこの列を読まない（再送は Edge Function の中で完結する）。

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS template_data jsonb;

COMMENT ON COLUMN public.email_send_log.template_data IS
  '送信時に渡された templateData。再送のときに描画し直すために持つ。'
  '送信結果の行（process-email-queue が書く sent / failed 等）には入らないので、'
  '同じ message_id の行から探すこと。';

-- 再送するとき「その message_id の材料はどれか」を引く。
-- 材料を持つ行だけの部分索引（履歴の大半は結果行で、材料を持たない）
CREATE INDEX IF NOT EXISTS email_send_log_payload_idx
  ON public.email_send_log (message_id)
  WHERE template_data IS NOT NULL;
