-- ============================================================================
-- 確認メール・リマインドメールに店ごとの一文を足せるようにする
-- ============================================================================
--
-- エアリザーブの「メール管理（文言のカスタマイズ）」に当たる。
-- ジムボードのメール文面はテンプレートに固定で、店ごとに1文字も変えられなかった。
-- 「当日は5分前にお越しください」「駐車場は建物裏です」といった、
-- **店ごとに必ず違う案内**を書ける場所が無い状態だった。
--
-- ## テンプレート全体を編集させない理由
--
-- 本文まるごとを店に編集させると、
--   - 日時・キャンセルリンクなど**必須の情報を消せてしまう**
--   - HTML を書けてしまう（メールの XSS ／レイアウト崩れ）
--   - 5言語・全テンプレートぶんの編集画面が要る
-- のが避けられない。**「決まった位置に1ブロック足せる」だけ**にすれば、
-- 実務上の要望（案内を1〜2行足したい）はほぼ満たせて、上の危険が全部消える。
--
-- ## 🔴 本文は必ずエンティティ化を通す
--
-- 店の自由入力がメール本文に入るのは初めて。
-- supabase/functions/_shared/email-encoding.ts の makeEmailHtmlAsciiSafe が
-- 送信直前に全テキストノードを `&#N;` にするので、
-- **テンプレート側は素の文字列を `<Text>` に渡すだけでよい**（React が
-- エスケープし、その後 ASCII 化される）。
-- dangerouslySetInnerHTML を使ってはいけない（2026-08-18 の文字化けの再来になる）。
--
-- ## 既定文は持たせない
--
-- NULL/空 ならブロックごと出さない。cancel_policy_body と同じ方針
-- （何を案内するかは店ごとに違うので、上流が代弁しない）。**backfill しない。**
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_email_note  TEXT,
  ADD COLUMN IF NOT EXISTS reminder_email_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_booking_email_note_len') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_booking_email_note_len
      CHECK (booking_email_note IS NULL OR char_length(booking_email_note) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_reminder_email_note_len') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_reminder_email_note_len
      CHECK (reminder_email_note IS NULL OR char_length(reminder_email_note) <= 500);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.booking_email_note IS
  '予約確認メール（会員・体験・ドロップイン）に足す、店からの案内。'
  'NULL/空ならブロックごと出さない。既定文は持たせない。最大500文字。';

COMMENT ON COLUMN public.tenants.reminder_email_note IS
  '前日リマインドメール（会員・体験）に足す、店からの案内。'
  'NULL/空ならブロックごと出さない。既定文は持たせない。最大500文字。';
