-- ============================================================================
-- プランの回数上限（GB004）の防御強化（レビューで確定した2件の修正）
-- ============================================================================
--
-- ## 1. 🔴 会員が profiles を書き換えて GB004 を無効化できた（critical）
--
-- guard_booking_plan_limit は profiles.plan / cycle_start_date / grace_enabled を
-- 判定の根拠にするが、profiles は本人が全列を UPDATE できる
-- （「Users can update own profile」。列の制限もガードも無かった）。
-- supabase-js を直接叩けば:
--
--   (A) cycle_start_date を NULL に → 「プラン未確定」扱いで GB004 が消える
--   (B) plan を実在しない名前に    → プラン行が引けず allow_overflow 不明で素通し
--   (C) cycle_start_date を今日に  → 窓が引き直され、また max_sessions 回取れる
--
-- 対策: profiles の BEFORE UPDATE ガード（guard_profile_plan_fields）。
-- **本人による自己更新だけ**を対象にする（店側・サービスロールは今までどおり）:
--
--   - plan / grace_enabled … 本人は変更不可（変える正規の画面が存在しない。
--     店が TrainerClientDetail から変えるのは auth.uid() ≠ user_id で素通し）
--   - cycle_start_date     … **NULL → 値の初回設定だけ許す**（1回目の予約日を
--     起算日にする既存の自動設定。rebaseCycleStartIfNeeded が会員セッションで走る）。
--     既に値がある行の変更は、**上限を強制しているプラン（allow_overflow=false）
--     でだけ拒否**する。既定(true)のプランでは従来どおり自由
--     （「使い切ったら次のルーティン」のロールの永続化が会員セッションで走るため。
--     強制していないプランでは書き換えても得るものが無い＝塞ぐ必要がない）
--
-- SQLSTATE は GB005。クライアントで拾う必要は無い（正規の画面からは到達しない）が、
-- GB00x の並びに登録して他の用途に使い回さないこと。
--
-- ⚠️ クライアント側もセットで変更済み: shouldRebaseCycleStart が allow_overflow=false
-- のとき「使い切ったらロール」を返さなくなった（useBookings が allow_overflow を渡す）。
-- そもそも試みないので、このガードは防波堤（正規アプリでは発火しない）。
--
-- ## 2. 回数券（ticket）に allow_overflow=false を付けても月次窓で数えていた
--
-- guard_booking_plan_limit は plan_type を見ずに常に plan_cycle_window（応当日
-- ベースの月次窓）で数える。回数券はクライアント（computePlanUsage）の窓が
-- 購入日起算 [起算日, 起算日+validity_days) で別物なので、
--   - 月をまたいで使うと DB 側では実質強制されない（毎月リセットされるため）
--   - 月内に集中して使うと有効期限内なのに拒否される
-- という両方向の食い違いになる。**subscription 以外は強制しない**を関数自身に
-- 持たせる（設定画面側もサブスク以外ではトグルを出さない・true で保存する）。
-- 回数券にも効かせたくなったら、月次窓ではなく購入日起算の一括窓で数える分岐を
-- 足すこと（mem/features/plan-session-limit.md）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles の契約3列のガード
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_plan_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  -- 店側（auth.uid() ≠ user_id）とサービスロール（auth.uid() IS NULL）は素通し。
  -- 制限（GB003/GB004）と同じ非対称: 縛るのはお客様のセルフサービスだけ。
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- 店側の人間（owner/trainer）が自分自身の行を触るのは許す。
  -- ⚠️ profiles.tenant_id は NULL の会員がいる（本番で確認）。所属は本人が書けない
  --    tenant_members から引く（profiles.tenant_id を信じると、それ自体も本人が
  --    書き換えられるので判定の根拠にできない）。
  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
     WHERE tm.user_id = v_actor AND tm.status = 'active'
       AND tm.role IN ('owner', 'trainer')
  ) THEN
    RETURN NEW;
  END IF;

  -- 契約の中身は本人には変えさせない（変える正規の画面が存在しない）
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.grace_enabled IS DISTINCT FROM OLD.grace_enabled THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  -- 起算日: NULL → 値の初回設定は許す（1回目の予約日を起算日にする既存の自動設定）。
  -- 既に値がある行の変更は、**上限を強制しているプラン（allow_overflow=false）の
  -- 会員でだけ拒否**する。既定(true)のプランは「使い切ったらロール」の永続化が
  -- 会員セッションで走る正規動線なので塞がない。
  IF NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date
     AND OLD.cycle_start_date IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.tenant_plans tp
        WHERE tp.plan_name = OLD.plan
          AND tp.allow_overflow = false
          AND tp.tenant_id IN (
            SELECT tm.tenant_id FROM public.tenant_members tm
             WHERE tm.user_id = OLD.user_id AND tm.status = 'active')
     ) THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_profile_plan_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_profile_plan_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_plan_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_plan_fields();

-- ----------------------------------------------------------------------------
-- 2. guard_booking_plan_limit: subscription 以外は強制しない
-- ----------------------------------------------------------------------------
-- ⚠️ 20260821040000 の定義に plan_type の取得と早期リターンを足しただけ。
--    他（代理の素通し・UPDATE の例外・advisory lock・窓と数え方）はそのまま。
--    CREATE OR REPLACE は最後の定義しか残らないので全文を書く。
CREATE OR REPLACE FUNCTION public.guard_booking_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor      UUID;
  v_plan       TEXT;
  v_cycle_start DATE;
  v_grace_on   BOOLEAN;
  v_ptype      TEXT;
  v_max        INT;
  v_months     INT;
  v_grace      INT;
  v_allow      BOOLEAN;
  v_target     DATE;
  v_ws         DATE;
  v_we         DATE;
  v_prev_ws    DATE;
  v_prev_we    DATE;
  v_prev_count INT;
  v_capacity   INT;
  v_tail_end   DATE;
  v_tail       INT;
  v_lent       INT := 0;
  v_in_window  INT;
  v_used       INT;
BEGIN
  -- 🔴 お客様が自分で取る予約だけを見る（代理・サービスロールは店の裁量）
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 日時が変わらない UPDATE は見ない。'キャンセル済み' からの復活だけは例外
  -- （GB003 と同じ理由: キャンセル行を置いて別を取り、あとで復活させる抜け道を塞ぐ）
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- お客様の契約（表示側 PlanUsageCard と同じ出どころ）
  SELECT p.plan, p.cycle_start_date, p.grace_enabled
    INTO v_plan, v_cycle_start, v_grace_on
    FROM public.profiles p
   WHERE p.user_id = NEW.user_id;

  -- 起算日が無い＝プラン未確定。表示側も UNCONFIGURED でカードを出さないので、判定しない
  IF v_plan IS NULL OR v_cycle_start IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tp.plan_type, tp.max_sessions, tp.cycle_months, tp.grace_days, tp.allow_overflow
    INTO v_ptype, v_max, v_months, v_grace, v_allow
    FROM public.tenant_plans tp
   WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = v_plan
   LIMIT 1;

  -- 🔴 月次窓（plan_cycle_window）で数えられるのはサブスクだけ。
  --    回数券（ticket）は購入日起算、期間（period）は回数無制限で、どちらも
  --    この関数の窓と合わない。設定画面もサブスク以外ではトグルを出さないが、
  --    DB を直接触られても意図しない窓で拒否しないよう関数自身でも絞る。
  IF COALESCE(v_ptype, 'subscription') <> 'subscription' THEN
    RETURN NEW;
  END IF;

  -- 🔴 allow_overflow が true / NULL（既定）なら何もしない＝今までどおり。
  --    プラン行が無い（旧データ互換の名称推定）ときも強制しない。
  IF v_allow IS DISTINCT FROM false THEN
    RETURN NEW;
  END IF;
  -- 通い放題（max_sessions NULL）と 0 以下は上限なし
  IF v_max IS NULL OR v_max <= 0 THEN
    RETURN NEW;
  END IF;

  v_months := GREATEST(COALESCE(v_months, 1), 1);
  v_grace  := GREATEST(COALESCE(v_grace, 0), 0);
  -- 猶予OFFのお客様には猶予を適用しない（PlanUsageCard の graceEnabled === false と同じ）
  IF v_grace_on IS false THEN
    v_grace := 0;
  END IF;

  -- 同一人物の同時リクエストで上限をすり抜けるレースを塞ぐ（GB003 と同じ）
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || NEW.user_id::text || 'plan'));

  v_target := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
  SELECT w.window_start, w.window_end INTO v_ws, v_we
    FROM public.plan_cycle_window(v_cycle_start, v_target, v_months) w;

  -- 猶予の繰入（graceLentToPrevCount と同じ）
  IF v_grace > 0 AND v_ws > v_cycle_start THEN
    SELECT w.window_start, w.window_end INTO v_prev_ws, v_prev_we
      FROM public.plan_cycle_window(v_cycle_start, v_ws - 1, v_months) w;

    SELECT count(*) INTO v_prev_count
      FROM public.bookings b
     WHERE b.tenant_id = NEW.tenant_id
       AND b.user_id   = NEW.user_id
       AND b.id IS DISTINCT FROM NEW.id
       AND b.status <> 'キャンセル済み'
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_prev_ws
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_ws;

    v_capacity := v_max - v_prev_count;
    IF v_capacity > 0 THEN
      v_tail_end := LEAST(v_ws + v_grace, v_we);
      SELECT count(*) INTO v_tail
        FROM public.bookings b
       WHERE b.tenant_id = NEW.tenant_id
         AND b.user_id   = NEW.user_id
         AND b.id IS DISTINCT FROM NEW.id
         AND b.status <> 'キャンセル済み'
         AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_ws
         AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_tail_end;
      v_lent := LEAST(v_capacity, v_tail);
    END IF;
  END IF;

  SELECT count(*) INTO v_in_window
    FROM public.bookings b
   WHERE b.tenant_id = NEW.tenant_id
     AND b.user_id   = NEW.user_id
     AND b.id IS DISTINCT FROM NEW.id
     AND b.status <> 'キャンセル済み'
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_ws
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_we;

  v_used := GREATEST(v_in_window - v_lent, 0);

  IF v_used >= v_max THEN
    RAISE EXCEPTION 'ご契約プランの回数の上限に達しています'
      USING ERRCODE = 'GB004';
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. 掃除: サブスク以外に allow_overflow=false が入っていたら既定に戻す
-- ----------------------------------------------------------------------------
-- 2 で強制対象外になった行に false が残っていると、DB は素通しなのに
-- クライアントの事前判定だけが塞ぐ「片側制限」になる。
-- （本番は 0 行のはずだが、設定画面が一時期 ticket にもトグルを出していた）
UPDATE public.tenant_plans
   SET allow_overflow = true
 WHERE COALESCE(plan_type, 'subscription') <> 'subscription'
   AND allow_overflow = false;
