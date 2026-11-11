-- ============================================================================
-- お客様の予約の占有時間（オプション）をサーバーで決め直す・店の Google カレンダーの予定 ID を画面から書けなくする（2026-11-11）
-- ============================================================================
-- 宗本さん「全部直すで」（2026-11-10 の定期点検）。指摘 check_booking_overlap-1・enforce_booking_update_guard-1・
-- google-calendar-sync-3（いずれも low）。
--
-- ■ 何が起きていたか
-- 1. 予約の占有時間は「プランの長さ＋オプションの時間（option_minutes）＋間」で、満枠・担当の重なり（check_booking_overlap）・
--    メニュー専用の時間（apply_booking_menu の GB011）はこの値を使う。option_minutes とオプションの控え（booking_options）は
--    画面が計算して送る値をそのまま入れていたので、お客様が API で
--      - 60分のオプションを付けて option_minutes を 0 にする → 検査をすり抜けて、先生がオプションの時間に二重予約になる
--      - option_minutes を 480 にする → その日の後ろ約9時間が満枠扱いになり、他のお客様・体験・店の代理予約が入らない
--    ことができた。控えの名前・値段も書き放題だった（店の予定表にそのまま出る）。
-- 2. 予約の google_event_id（店の Google カレンダーの予定 ID）をお客様が INSERT・UPDATE で書けた。google-calendar-sync は
--    この列の値で「もう予定がある」かを決め、予約の取り消しではこの ID の予定を店のトークンで消すので、
--      - 値を空・でたらめにして create を呼ぶ → 同じ予約の予定が店のカレンダーに何件でも増える
--      - 外で知った予定の ID を入れて delete を呼ぶ → オーナーのカレンダーからその予定を消せる
--    ことができた（画面はこの列を一度も書かない。書くのは service_role の google-calendar-sync だけ）。
--
-- ■ 直し方
-- 1. BEFORE INSERT の normalize_customer_booking_insert（トリガー aa_normalize_customer_booking）:
--    - ログインした人の INSERT では google_event_id を必ず NULL にする（店の代理予約も。画面は書かない）。
--    - お客様ご自身の予約（auth.uid() = user_id）では、booking_options の id から、そのジムのオプションの表で
--      控え（名前・時間・値段）と option_minutes を作り直す。
--        - 受付を止めた（enabled = false）オプションも数える（止める前に付けた予約を日時の変更で動かせるように）
--        - そのジムに無い id・形の崩れた要素・同じ id の2回目は捨てる（時間に数えない）。断らない:
--          日時の変更・その失敗の戻しは元の予約の控えをそのまま送るので、店がオプションを消したあとに断ると、
--          元の予約が消えたまま戻せなくなる（アプリの rescheduleBooking は「消す → 作る」）。
--      今の画面は表の値をそのまま送っているので、正規の予約では結果は変わらない（本番の予約で、控えと表が
--      食い違う行は0件・2026-11-11）。店の代理予約・あとからの付け足し（GB008）は今まで通り。
--    🔴 トリガーは名前の順に動く。option_minutes を読む apply_booking_menu（GB011）・prevent_booking_overlap より先に
--       動かすため、名前の先頭を aa_ にしている。名前を変えないこと（見張り: src/test/bookingInsertNormalize.test.ts）。
-- 2. enforce_booking_update_guard（本番の定義を写して1つ足す）: ログインした人は google_event_id を変えられない
--    （スタッフの早い return より前に置く。インストラクターも同じ）。サーバー（auth.uid() が無い）は今まで通り。
-- 3. google-calendar-sync（Edge Function）は、予定を作る前に条件付きの UPDATE で「作る権利」を取る（同時に何度呼ばれても
--    1予約1件）。Google の予定 ID の形でない値は Google に送らない。
--
-- 残り（このマイグレーションでは直さない）: お客様の予約の booking_type（プラン名）は今も本人が送る値のまま
-- （契約のプランと一致させるかは仕様の確認が要る。mem/ops/tenant-boundary.md 穴37）。
--
-- 見張り: src/test/bookingInsertNormalize.test.ts・src/test/googleCalendarSyncAuthz.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalize_customer_booking_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_elem    jsonb;
  v_raw_id  text;
  v_id      uuid;
  v_seen    uuid[] := ARRAY[]::uuid[];
  v_opt     record;
  v_out     jsonb := '[]'::jsonb;
  v_minutes integer := 0;
BEGIN
  -- サーバー（Edge Function・cron。auth.uid() が無い）は今まで通り
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- (1) 店の Google カレンダーの予定 ID は、サーバー（google-calendar-sync）だけが書く
  NEW.google_event_id := NULL;

  -- (2) 占有の長さ・オプションの控えを決め直すのは、お客様ご自身の予約だけ（店の代理予約は店が決める）
  IF v_uid IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_options IS NOT NULL AND jsonb_typeof(NEW.booking_options) = 'array' THEN
    FOR v_elem IN SELECT e FROM jsonb_array_elements(NEW.booking_options) AS t(e) LOOP
      v_id := NULL;
      IF jsonb_typeof(v_elem) = 'object' THEN
        v_raw_id := v_elem ->> 'id';
        IF v_raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_id := v_raw_id::uuid;
        END IF;
      END IF;
      -- 形の崩れた要素・同じオプションの2回目は捨てる
      CONTINUE WHEN v_id IS NULL OR v_id = ANY (v_seen);

      SELECT o.id, o.name, o.duration_minutes, o.price_yen
        INTO v_opt
        FROM public.booking_options o
       WHERE o.id = v_id AND o.tenant_id = NEW.tenant_id;
      -- そのジムに無いオプションは捨てる（時間に数えない・控えに残さない）
      CONTINUE WHEN NOT FOUND;

      v_seen := v_seen || v_id;
      v_minutes := v_minutes + GREATEST(COALESCE(v_opt.duration_minutes, 0), 0);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'id', v_opt.id,
        'name', v_opt.name,
        'duration_minutes', v_opt.duration_minutes,
        'price_yen', v_opt.price_yen
      ));
    END LOOP;
  END IF;

  NEW.option_minutes := v_minutes;
  NEW.booking_options := CASE WHEN jsonb_array_length(v_out) > 0 THEN v_out ELSE NULL END;
  RETURN NEW;
END;
$function$;

-- トリガーの関数は直接呼ばせない（トリガーとしてだけ動く）
REVOKE ALL ON FUNCTION public.normalize_customer_booking_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_normalize_customer_booking ON public.bookings;
CREATE TRIGGER aa_normalize_customer_booking
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.normalize_customer_booking_insert();

CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 店の Google カレンダーの予定 ID は、サーバー（google-calendar-sync）だけが書く（2026-11-11 点検
  -- enforce_booking_update_guard-1・google-calendar-sync-3）。スタッフの早い return より前に置く（インストラクターも同じ）
  IF NEW.google_event_id IS DISTINCT FROM OLD.google_event_id THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN
    RETURN NEW;
  END IF;

  -- お客様（その予約のジムのスタッフでない人）は、予約の枠を決める列を変えられない（2026-11-01）。
  -- 🔴 満枠・ブロック枠・休みの日・メニュー・限定オプションの検査は INSERT のときだけ動くものが多い。
  --    アプリの日時の変更は「消して作る」ので、これらを UPDATE で変える正規の操作は無い。
  IF NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.booking_type IS DISTINCT FROM OLD.booking_type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id
     OR NEW.menu_id IS DISTINCT FROM OLD.menu_id
     OR NEW.option_minutes IS DISTINCT FROM OLD.option_minutes
     OR NEW.booking_options IS DISTINCT FROM OLD.booking_options THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 店が取り消した予約は、お客様からは戻せない（戻すと満枠の検査を通らずに枠を取り直せる）（2026-11-01）
  IF OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 消化(同日キャンセル済み)からの遷移は予約日当日(JST)のみ許可
  IF OLD.status = '同日キャンセル済み'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
           <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION '消化扱いの予約は変更できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
