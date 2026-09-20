-- ============================================================================
-- オプションの説明文に長さの上限を付ける（2026-09-20）
--
-- 宗本さんの要望:
--
--   > こんな感じでオプションに、僕のジムの場合ならストレッチの説明やメリットも
--   > 説明書きしたい。
--
-- `booking_options.description` は **2026-09-02 の時点で既にある**（列も、
-- 公開RPC `get_tenant_booking_options` の戻りも、`BookingOptionPicker` の表示も）。
-- 足りなかったのは次の2つで、どちらも画面側:
--
--   1. 店の設定画面（`TrainerBookingOptions.tsx`）に入力欄が無く、**設定できなかった**
--      （select にも description を含めていなかった）
--   2. お客様が読む確認カード（`BookingOptionConfirm.tsx`）に**出していなかった**
--
-- このマイグレーションでやるのは**上限の CHECK だけ**。
--
-- ## なぜ上限が要るか
--
-- この文章はお客様が**予約の確認カードで読む**。長すぎると「この内容で予約する」が
-- 画面外へ押し出され、予約そのものが取りにくくなる。
-- 400字はスマホで約12行。`src/lib/bookingOptions.ts` の `OPTION_DESCRIPTION_MAX`
-- と**同じ値**。片方だけ変えないこと。
--
-- 既存の行はすべて description が NULL なので、この制約は即座に通る（検証で確認済み）。
-- ============================================================================

ALTER TABLE public.booking_options
  DROP CONSTRAINT IF EXISTS booking_options_description_len;

ALTER TABLE public.booking_options
  ADD CONSTRAINT booking_options_description_len
  CHECK (description IS NULL OR char_length(description) <= 400);

COMMENT ON COLUMN public.booking_options.description IS
  'オプションの説明文。**お客様が予約の確認カードで読む**（店内メモではない）。'
  'NULL/空なら名前と時間・料金だけを出す（従来どおり）。400字まで。'
  '上限は src/lib/bookingOptions.ts の OPTION_DESCRIPTION_MAX と揃えること。';
