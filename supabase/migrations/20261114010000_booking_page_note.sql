-- ============================================================================
-- 「予約画面のご案内」を、お客様の予約画面のいちばん上に出せるようにする（2026-11-14）
--
-- 宗本さん「予約画面の一番上にも出せるようにして」（伝えたいのは「次回分のご予約も前もって取れる・
-- お支払いは毎回1回目のトレーニングの日」）。「ご来店前のお願い」（pre_visit_note）は予約完了の画面と
-- ホームの「次回の予約」にしか出ず、予約画面の上には「キャンセルについて」しか出せなかった。
--
-- `booking_page_note` に文を入れたジムだけ、会員の予約画面（日時を選ぶ画面）のいちばん上に
-- 「ご予約について」として出す（src/lib/bookingPageNote.ts）。文は店が自由に書く。
-- **NULL（既定）は今まで通り**＝設定していないジムの見え方は変わらない。
-- 体験予約・ドロップイン（未ログインの公開ページ）には出さない（get_tenant_public には足さない）。
-- 書けるのは今まで通りオーナーだけ（tenants の UPDATE のポリシー）。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は本番で直接行う）。
-- 見張り: src/test/bookingPageNote.test.tsx
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_page_note text;

-- 長さは src/lib/bookingPageNote.ts の BOOKING_PAGE_NOTE_MAX と同じ（テストが一致を見張る）
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_booking_page_note_length;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_booking_page_note_length
  CHECK (booking_page_note IS NULL OR char_length(booking_page_note) <= 300);

COMMENT ON COLUMN public.tenants.booking_page_note IS
  'お客様の予約画面のいちばん上に出す「ご予約について」の文（例: 次回分のご予約も前もってお取りいただけます）。会員の予約画面だけに出す。NULL は出さない';
