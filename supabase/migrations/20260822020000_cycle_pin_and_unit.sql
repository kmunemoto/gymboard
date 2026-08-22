-- ============================================================================
-- 起算日の固定（店の設定が最上位）＋利用期間の単位（ヶ月/週/日）（2026-08-22）
-- ============================================================================
--
-- 宗本さんの要望2件:
--   (1) お店側で決める利用期間（起算日）が**一番上の権限**を持つようにしたい。
--       自動ルール（1回目の予約日に合わせる・使い切りロール）は残してよいが、
--       店が固定した起算日をそれらが動かしてはいけない。
--   (2) 利用期間はうちは1ヶ月だが、お店によって違う。ヶ月だけでなく
--       週・日でも細かく設定できるようにしたい。
--
-- ## (1) profiles.cycle_start_pinned（起算日の固定）
--
-- 🔴 **明示的なスイッチ**にする（店が起算日を手で入れただけでは固定しない）。
--    既存の運用（手で直しても、次の使い切りロールでまた進む）を暗黙に変えると、
--    自動ルール前提で回っている他のテナントの挙動が変わってしまうため。
--
-- 固定中のお客様では:
--   - クライアント: shouldRebaseCycleStart が常に false（起算日の自動書き換えなし）、
--     resolveEffectiveCycle が使い切りロールも1回目起点の引き直し表示もしない
--     ＝ 起算日から暦どおりに進む純粋な窓。DB（guard_booking_plan_limit）は
--     もともと純粋な暦窓で数えるので、固定中はDBと表示が完全に一致する。
--   - DB: 本人（会員セッション）による cycle_start_date の変更を GB005 で拒否
--     （固定していても allow_overflow=true だと従来は本人が書き換え可能だった穴を塞ぐ）。
--     cycle_start_pinned 自体も本人は変更不可。店・サービスロールは従来どおり素通し。
--
-- ## (2) tenant_plans.cycle_unit（利用期間の単位）
--
-- cycle_months は「単位数」として使い回す（列名は歴史的なもの。値の意味は
-- cycle_unit で決まる: months=ヶ月, weeks=週, days=日。NULL は months）。
--   - months … 従来どおり応当日ベース・**応当日を含む**（6/5開始→7/5まで。翌サイクルは7/6から）。
--     既存プランの窓を1日も変えないため、この規則は変更しない。
--   - weeks / days … **ちょうど N×7日 / N日** の連続窓 [start, start+span)。
--     翌サイクルは end 当日から（月と違い応当日の概念が無いので最終日を共有しない）。
--
-- ⚠️ 公開済みの旧クライアントは cycle_unit を知らないため、週・日のプランを
--    cycle_months ヶ月として表示する（例: 4週 → 4ヶ月と誤表示）。DB の強制
--    （GB004）とサーバー通知（push-period-reminder）は本マイグレーション＋
--    再デプロイで正しくなる。単位を月以外にする店は新ビルド配布後に案内する。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 列の追加
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cycle_start_pinned BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.cycle_start_pinned IS
  '起算日（cycle_start_date）を店の設定で固定する。true の間は自動調整（1回目の予約日への合わせ込み・使い切りロール）を行わず、本人による変更も GB005 で拒否する';

ALTER TABLE public.tenant_plans
  ADD COLUMN IF NOT EXISTS cycle_unit TEXT
  CHECK (cycle_unit IN ('months', 'weeks', 'days'));

COMMENT ON COLUMN public.tenant_plans.cycle_unit IS
  '利用期間（cycle_months）の単位。months=ヶ月（応当日を含む・従来どおり）、weeks=週（N×7日ちょうど）、days=日（N日ちょうど）。NULL は months';

-- ----------------------------------------------------------------------------
-- 2. plan_cycle_window の単位対応（4引数オーバーロード）
-- ----------------------------------------------------------------------------
-- 3引数版（months 専用）は旧定義のまま残す（互換）。単位を見るのはこちら。
CREATE OR REPLACE FUNCTION public.plan_cycle_window(
  p_cycle_start DATE,
  p_target DATE,
  p_cycle_len INT,
  p_cycle_unit TEXT
)
RETURNS TABLE (window_start DATE, window_end DATE)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_len  INT := GREATEST(COALESCE(p_cycle_len, 1), 1);
  v_span INT;
  v_start DATE;
BEGIN
  -- months（NULL・不明値含む）は従来の3引数版に委譲（応当日を含む規則）
  IF p_cycle_unit IS DISTINCT FROM 'weeks' AND p_cycle_unit IS DISTINCT FROM 'days' THEN
    RETURN QUERY SELECT w.window_start, w.window_end
      FROM public.plan_cycle_window(p_cycle_start, p_target, v_len) w;
    RETURN;
  END IF;

  -- 週・日: ちょうど span 日の連続窓 [start, start+span)。翌サイクルは end 当日から
  v_span := CASE WHEN p_cycle_unit = 'weeks' THEN v_len * 7 ELSE v_len END;

  -- 起算日より前は最初のサイクルを返す（架空の「前回」を作らない）
  IF p_target < p_cycle_start THEN
    RETURN QUERY SELECT p_cycle_start, p_cycle_start + v_span;
    RETURN;
  END IF;

  -- 連続窓なので直接計算できる（日付の差は整数日・整数除算は切り捨て）
  v_start := p_cycle_start + ((p_target - p_cycle_start) / v_span) * v_span;
  RETURN QUERY SELECT v_start, v_start + v_span;
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_cycle_window(DATE, DATE, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_cycle_window(DATE, DATE, INT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. guard_booking_plan_limit: プランの cycle_unit で窓を引く
-- ----------------------------------------------------------------------------
-- ⚠️ 20260821070000 の定義に v_unit の取得と plan_cycle_window の4引数化を
--    足しただけ。他（代理の素通し・UPDATE の例外・advisory lock・数え方）はそのまま。
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
  v_unit       TEXT;
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

  SELECT tp.plan_type, tp.max_sessions, tp.cycle_months, tp.cycle_unit, tp.grace_days, tp.allow_overflow
    INTO v_ptype, v_max, v_months, v_unit, v_grace, v_allow
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
    FROM public.plan_cycle_window(v_cycle_start, v_target, v_months, v_unit) w;

  -- 猶予の繰入（graceLentToPrevCount と同じ）
  IF v_grace > 0 AND v_ws > v_cycle_start THEN
    SELECT w.window_start, w.window_end INTO v_prev_ws, v_prev_we
      FROM public.plan_cycle_window(v_cycle_start, v_ws - 1, v_months, v_unit) w;

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
-- 4. guard_profile_plan_fields: 固定スイッチと固定中の起算日を本人から守る
-- ----------------------------------------------------------------------------
-- ⚠️ 20260821070000 の定義に cycle_start_pinned の2規則を足しただけ。
--    （本人は cycle_start_pinned を変更不可／固定中は cycle_start_date も変更不可）
--    CREATE OR REPLACE は最後の定義しか残らないので全文を書く。
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

  -- 契約の中身は本人には変えさせない（変える正規の画面が存在しない）。
  -- cycle_start_pinned（起算日の固定スイッチ）も店だけが操作できる契約フィールド。
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.grace_enabled IS DISTINCT FROM OLD.grace_enabled
     OR NEW.cycle_start_pinned IS DISTINCT FROM OLD.cycle_start_pinned THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  -- 起算日: NULL → 値の初回設定は許す（1回目の予約日を起算日にする既存の自動設定）。
  -- 既に値がある行の変更は、
  --   (a) 店が起算日を固定しているお客様（cycle_start_pinned）… 常に拒否
  --       （店の設定が最上位。クライアントの自動調整も pinned では動かないので
  --        正規アプリからは到達しない防波堤）
  --   (b) 上限を強制しているプラン（allow_overflow=false）… 従来どおり拒否
  -- のどちらかに当てはまるときだけ拒否する。既定(true)・未固定のお客様は
  -- 「使い切ったらロール」の永続化が会員セッションで走る正規動線なので塞がない。
  IF NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date
     AND OLD.cycle_start_date IS NOT NULL
     AND (
       OLD.cycle_start_pinned
       OR EXISTS (
         SELECT 1 FROM public.tenant_plans tp
          WHERE tp.plan_name = OLD.plan
            AND tp.allow_overflow = false
            AND tp.tenant_id IN (
              SELECT tm.tenant_id FROM public.tenant_members tm
               WHERE tm.user_id = OLD.user_id AND tm.status = 'active')
       )
     ) THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_profile_plan_fields() FROM PUBLIC, anon, authenticated;
