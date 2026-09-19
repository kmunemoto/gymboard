-- ============================================================================
-- 手で止めた日は、体験予約・ドロップインも受け付けない
--
-- 2026-09-19 宗本さんの決定。きっかけは予定表で実際に日を赤くしたあとの質問:
--
--   > これ押して赤くなってる日は予約が入れられなくなる？
--
-- 本番で実測してお見せした結果（すべてロールバック済み）:
--
--   お客様の自己予約 x 手で止めた日 = 断られた [GB007]
--   店の代理予約     x 手で止めた日 = 入った（仕様）
--   体験予約         x 手で止めた日 = **入った（止まらない）**  ← ここを直す
--
-- ## 🔴 「手で止めた日」と「上限に達した日」を混ぜないこと
--
-- 2026-09-01 の決定は生きている:「体験予約は上限なく受け付けます」。
-- したがって:
--
--   手で止めた日（booking_closed_days に行がある） … 体験・ドロップインも止める ← 追加
--   上限に達した日（tenants.daily_booking_limit）  … 今までどおり体験は受ける
--
-- `tenant_day_closed()` は**両方**を true にするので、**ここでは使わない**。
-- 使うと「上限に達した日は体験も断る」になり、上の決定を黙って覆す。
-- `booking_closed_days` は手で止めた日**だけ**が入るテーブルなので、それを直接見る。
--
-- 数え方は変えない。**体験は今も1日の人数に数えない**
-- （tenant_day_booking_count は bookings しか見ていない。ここでは触らない）。
--
-- ## 🔴 これは 2026-09-01 の決定の取り消しではない（名前が同じなので紛らわしい）
--
-- `trg_guard_trial_booking_day_closed` / `guard_trial_booking_day_closed()` は
-- 20260901000000_booking_daily_cap.sql が作り、20260901010000_trial_exempt_from_daily_cap.sql
-- が**意図的に削除した**もの。ここで同じ名前を作り直しているが、中身は別物:
--
--   旧（〜2026-09-01）… BEFORE INSERT OR UPDATE / `tenant_day_closed()`（手動＋上限）
--   新（2026-09-19〜）… BEFORE INSERT のみ      / `booking_closed_days`（手動だけ）
--
-- 「体験は上限なく受け付ける」は**生きている**。変えたのは「手で止めた日」だけ。
--
-- ## 店の代理予約は従来どおり通す
--
-- 会員側の guard_booking_day_closed と同じ非対称にする。体験・ドロップインの行は
-- 公開ページ（Edge Function の service_role）からしか入らず、店が予定表から
-- 体験を代理で入れる導線は無い。そのため役割での出し分けはしない
-- （将来その導線を作るときは、ここに auth.uid() の分岐が要る）。
--
-- ## ⚠️ 文面に「この時間帯」を入れないこと
--
-- trial-book は insert のエラー文に「この時間帯」が含まれていると slot_taken と
-- 判定し、「別の時間をお選びください」と案内してしまう（＝受付終了だと伝わらない）。
-- 会員側と同じ「この日はご予約の受付を終了しました」に揃える。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_trial_booking_day_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 取り込み（salute_sync）は過去分の流し込みなので素通しする。
  -- 会員側の guard_booking_day_closed と同じ作法。
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL OR NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- 🔴 手で止めた日**だけ**。上限に達しただけの日はここに行が無いので素通りする。
  --    tenant_day_closed() を呼ばないこと（あちらは上限も true にする）。
  IF EXISTS (
    SELECT 1 FROM public.booking_closed_days d
     WHERE d.tenant_id = NEW.tenant_id
       AND d.closed_date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) THEN
    RAISE EXCEPTION 'この日はご予約の受付を終了しました' USING ERRCODE = 'GB007';
  END IF;

  RETURN NEW;
END;
$function$;

-- INSERT だけに掛ける。日程変更は公開ページから入れ直す（＝INSERT）ため、
-- UPDATE に掛けると「すでに入っている予約の状態を店が直す」操作まで止まる。
-- 直接呼べないようにしておく（このリポジトリの既存の作法）。
REVOKE ALL ON FUNCTION public.guard_trial_booking_day_closed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_trial_booking_day_closed ON public.trial_bookings;
CREATE TRIGGER trg_guard_trial_booking_day_closed
  BEFORE INSERT ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_trial_booking_day_closed();
