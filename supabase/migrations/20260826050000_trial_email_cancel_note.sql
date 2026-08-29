-- 体験メール（確認・前日リマインド）の「キャンセル・変更」欄を店ごとの文章にできるようにする。
--
-- これまでこの欄はテンプレートの固定文（「ご都合が悪くなった場合は、下記のジムの
-- メールアドレスへご連絡ください。」＋ tenants.email への mailto リンク）だった。
-- キャンセルの連絡先・方針は店ごとに違う（LINE・電話・メール）ので、
-- 上流が文章を代弁しない（cancel_policy_body / email_note と同じ方針。2026-08-26 決定）。
--
-- 🔴 設定した場合は**その文章だけ**を出す。メールアドレスのリンクも自動では足さない
--    （「お電話ください」と書いたのに mailto リンクが残る、という食い違いを作らないため）。
--    NULL/空なら従来の固定文＋リンクのままで、見た目は1ピクセルも変わらない。
--
-- 既定文の backfill はしない（全店 NULL スタート＝挙動不変）。

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial_email_cancel_note TEXT;

-- 文字数上限は他の店別文言と同じ500（クライアントの EMAIL_NOTE_MAX_LENGTH と同値。
-- src/test/trialCancelNote.test.ts が一致を見張る）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_trial_email_cancel_note_len'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_trial_email_cancel_note_len
      CHECK (trial_email_cancel_note IS NULL OR char_length(trial_email_cancel_note) <= 500);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.trial_email_cancel_note IS
  '体験の確認・リマインドメールの「キャンセル・変更」欄の文章。NULL/空なら従来の固定文（ジムのメールアドレスへの案内）。設定時はこの文章だけを出す（リンクは足さない）。上限500文字。';
