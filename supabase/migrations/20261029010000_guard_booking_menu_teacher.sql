-- ============================================================================
-- メニューの先生（ヨガ・ピラティス等）は、担当のメニューがオンのときだけお客様の指名を受ける（2026-10-29）
-- ============================================================================
-- 出回っている古いアプリ（予約メニューを知らない版）は、スタッフが2人以上いるジムで
-- お客様の予約画面に「担当を選ぶ」を出し、メニューを送らずに担当だけを指名して予約を入れる。
-- apply_booking_menu はこの予約をそのまま通す（menu_id は NULL のまま）ので、先生を迎えてから
-- 担当のメニューをオンにするまでの間（メニューをオフにしている間も）、その先生が
-- 普通のトレーニングで指名されてしまう。
--
-- 断るのは、次のすべてに当てはまるときだけ:
--   - お客様ご自身の新しい予約（apply_booking_menu の v_self と同じ）。店の代理予約・サーバー・
--     日時の変更の作り直し（created_via = 'reschedule'）・旧システムからの同期は見ない
--   - 指名した担当がインストラクター（trainer。2026-10-28 から trainer は必ず limited）
--   - その担当のメニューがこのジムに1つ以上あり、オンのものが1つも無い
-- オーナーと、メニューを持たないインストラクター（メニューを使っていない店の先生）は今まで通り指名できる。
-- メニューがオンになれば、古いアプリからの指名は今まで通り通る（mem/features/booking-menus.md「既知の穴」）。
--
-- コードは GB002（指名した担当のシフト外）。古いアプリもこのコードを知っていて
-- 「別のトレーナーか別の曜日をお選びください」と案内する。新しいコードにすると、古いアプリは
-- 「アプリが古い」と案内してしまう（src/lib/bookingErrors.ts）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_booking_menu_teacher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.staff_user_id IS NULL OR NEW.tenant_id IS NULL
     OR (to_jsonb(NEW) ->> 'source') = 'salute_sync'
     OR NEW.created_via IS NOT DISTINCT FROM 'reschedule' THEN
    RETURN NEW;
  END IF;

  -- お客様ご自身の予約だけ（店の代理予約・サーバーは見ない）
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.tenant_id AND tm.user_id = NEW.staff_user_id
          AND tm.role = 'trainer' AND tm.staff_access = 'limited'
     )
     AND EXISTS (
       SELECT 1 FROM public.booking_menus m
        WHERE m.tenant_id = NEW.tenant_id AND m.staff_user_id = NEW.staff_user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.booking_menus m
        WHERE m.tenant_id = NEW.tenant_id AND m.staff_user_id = NEW.staff_user_id AND m.is_active
     ) THEN
    RAISE EXCEPTION 'この担当者は今は予約を受け付けていません（担当のメニューがオフ）' USING ERRCODE = 'GB002';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_booking_menu_teacher() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_menu_teacher ON public.bookings;
CREATE TRIGGER trg_guard_booking_menu_teacher
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_menu_teacher();
