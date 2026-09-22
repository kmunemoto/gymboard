-- 次回分の入金が確認できるまで、次回分の予約を受け付けない（店ごと ON/OFF・既定 OFF）
--
-- 実店舗の要望（2026-09-22 宗本さん）:
--
-- > お店側が次回分の料金を払ってないと次回分の予約が取れないようにするシステム。
-- > 今回の最後の予約時に次回の支払いをしてもらい、次回分の予約が取れるようになる。
-- > まだ今回の予約の途中だけど次回分の予約を取りたいなら、まだ今回の最後の予約では
-- > ないが支払う。
--
-- ## 🔴 規則は1文にする
--
--   次回分の予約は、次回分のお支払いが確認できてから取れる。
--
-- 「最後の予約のときに払う」は**決まりではなく、いちばん多いタイミング**というだけ。
-- 途中で払ってもいい。「どれが最後の予約か」をシステムに判定させない——キャンセルや
-- 日時変更で動くので、判定すれば必ずズレる。**見るのは「払ったか」だけ**にする。
--
-- 「次回の1回目までは払わずに取れる」案は**入れない**（同日に検討して落とした）。
-- 途中でも払えるので逃げ道が要らず、残すと規則が2文になり、1回分を払わずに
-- 受けられる穴が構造として残る。
--
-- ## 何をもって「次回分」とするか
--
-- **暦のサイクル窓**（`plan_cycle_window`）。起算日の応当日ベースで、
-- 予約の入り方に左右されない。窓は連続していて、どの日付もちょうど1つの窓に属する。
--
-- ⚠️ `resolveEffectiveCycle`（画面の「利用期間」）の**使い切りロールは使わない**。
-- あちらは「回数を使い切ったら次のルーティンが始まる」で窓が動くが、動く先は
-- 「(上限+1)回目の予約日」なので、**予約が入って初めて決まる**。
-- 「その予約を入れていいか」を決める側がそれを参照すると循環する。
--
-- 回数の超過そのもの（月4回の5回目）を止めたいなら、それは既にある
-- `tenant_plans.allow_overflow = false`（GB004）の仕事。**別の設定として重ねられる**:
--
--   allow_overflow = false          … 今サイクルの5回目を止める
--   next_cycle_payment_required     … 次サイクルの予約を、入金まで止める
--
-- ## 誰に効くか（GB003/GB004/GB006/GB007 と同じ非対称）
--
--   お客様の自己予約 … 止まる
--   店側の代理予約   … **止まらない**。「払い忘れたけど次回もらう」は店の裁量に残す
--   体験・ドロップイン … 無関係（`trial_bookings` は別テーブル・トリガー無し）
--
-- ## 🔴 ON にした時点で進行中のサイクルは「払い済み」扱い
--
-- これが無いと、ON にした瞬間に**在籍会員全員が同時に予約できなくなる**
-- （本番の Salute御所南で 38 人）。`next_cycle_payment_required_since` に
-- ON にした日を入れ、**その日までに始まっていた窓は払い済みとみなす**。
-- 偽の入金行を作らないので、入金履歴も汚さない。

-- ============================================================
-- 1) 店の設定（tenants）
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS next_cycle_payment_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS next_cycle_payment_required_since date;

COMMENT ON COLUMN public.tenants.next_cycle_payment_required IS
  '次回分の入金を確認するまで、次回分（次のサイクル窓）の予約を受け付けないか。既定false。店側の代理予約には効かない。';
COMMENT ON COLUMN public.tenants.next_cycle_payment_required_since IS
  'この設定をONにした日。🔴 この日までに始まっていたサイクル窓は「払い済み」扱いにする（ONにした瞬間に在籍会員が全員止まるのを防ぐ）。OFFにしてもクリアせず、次にONにしたときに上書きする。';

-- ============================================================
-- 2) 入金が「どのサイクル分か」を持たせる（member_payments）
-- ============================================================
-- 既存の行は NULL のまま＝どのサイクルにも紐づかない純粋な履歴。
-- 「次回分 入金済み」から作られた行だけがサイクル窓の開始日を持つ。
ALTER TABLE public.member_payments
  ADD COLUMN IF NOT EXISTS covers_cycle_start date;

COMMENT ON COLUMN public.member_payments.covers_cycle_start IS
  'この入金が充当されるサイクル窓の開始日（plan_cycle_window の window_start）。NULL＝サイクルに紐づかない履歴（入会金・都度払いなど、2026-09-22 より前の行は全てこれ）。';

-- 同じサイクルを二重に「入金済み」にできないようにする（連打・二重記録の防止）。
CREATE UNIQUE INDEX IF NOT EXISTS member_payments_cycle_unique
  ON public.member_payments (tenant_id, user_id, covers_cycle_start)
  WHERE covers_cycle_start IS NOT NULL;

-- ============================================================
-- 3) 「最初の未入金サイクル」を出す（判定の本体はここ1本だけ）
-- ============================================================
-- 🔴 **お客様の画面と DB のトリガーが、この同じ関数を呼ぶ。**
--    画面が「取れる」と見せた日を DB が断る——このリポジトリで最も避けたいズレ——を
--    構造的に起こさないため、規則を2箇所に書かない。
--
-- 返すのは「この日以降の予約には入金が要る」という1つの日付。
-- NULL＝止めるものが無い（設定OFF・プラン未確定・サブスク以外・全部払い済み）。
--
-- 窓は今日の窓から順に前から見て、**払い済みなら次の窓へ**進む。
-- 飛ばして先のサイクルだけ払っても開かない（順番に払う、が規則）。
CREATE OR REPLACE FUNCTION public.member_first_unpaid_cycle_start(
  p_tenant_id uuid,
  p_user_id uuid
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_required  BOOLEAN;
  v_since     DATE;
  v_plan      TEXT;
  v_cycle_start DATE;
  v_ptype     TEXT;
  v_months    INT;
  v_unit      TEXT;
  v_today     DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_ws        DATE;
  v_we        DATE;
  v_guard     INT := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.next_cycle_payment_required, t.next_cycle_payment_required_since
    INTO v_required, v_since
    FROM public.tenants t
   WHERE t.id = p_tenant_id;

  -- 設定OFF（既定）なら何も止めない
  IF v_required IS DISTINCT FROM true THEN
    RETURN NULL;
  END IF;
  -- ON なのに since が無い（直接 UPDATE された等）。今日までを払い済み扱いにして安全側へ
  v_since := COALESCE(v_since, v_today);

  SELECT p.plan, p.cycle_start_date
    INTO v_plan, v_cycle_start
    FROM public.profiles p
   WHERE p.user_id = p_user_id;

  -- 起算日が無い＝プラン未確定。サイクルの概念が無いので止めない（GB004 と同じ）
  IF v_plan IS NULL OR v_cycle_start IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tp.plan_type, tp.cycle_months, tp.cycle_unit
    INTO v_ptype, v_months, v_unit
    FROM public.tenant_plans tp
   WHERE tp.tenant_id = p_tenant_id AND tp.plan_name = v_plan
   LIMIT 1;

  -- 🔴 暦のサイクル窓で数えられるのはサブスクだけ。回数券は購入日起算、
  --    期間制は回数無制限で、どちらもこの窓と合わない（GB004 と同じ絞り）。
  IF COALESCE(v_ptype, 'subscription') <> 'subscription' THEN
    RETURN NULL;
  END IF;
  -- 通い放題（max_sessions が NULL）も**対象に含む**。回数は無制限でも月謝は要る。

  v_months := GREATEST(COALESCE(v_months, 1), 1);

  -- 今日の属する窓から前へ順に見る
  SELECT w.window_start, w.window_end INTO v_ws, v_we
    FROM public.plan_cycle_window(v_cycle_start, v_today, v_months, v_unit) w;

  -- 上限 240 回（月次なら20年分）。無限ループの保険であって、規則ではない
  WHILE v_guard < 240 LOOP
    v_guard := v_guard + 1;

    -- ONにした時点で既に始まっていた窓は払い済み扱い（全員が同時に止まるのを防ぐ）
    IF v_ws <= v_since THEN
      SELECT w.window_start, w.window_end INTO v_ws, v_we
        FROM public.plan_cycle_window(v_cycle_start, v_we, v_months, v_unit) w;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.member_payments mp
       WHERE mp.tenant_id = p_tenant_id
         AND mp.user_id   = p_user_id
         AND mp.covers_cycle_start = v_ws
    ) THEN
      SELECT w.window_start, w.window_end INTO v_ws, v_we
        FROM public.plan_cycle_window(v_cycle_start, v_we, v_months, v_unit) w;
      CONTINUE;
    END IF;

    RETURN v_ws;
  END LOOP;

  RETURN v_ws;
END;
$function$;

COMMENT ON FUNCTION public.member_first_unpaid_cycle_start(uuid, uuid) IS
  'この日以降の予約には次回分の入金が要る、という1つの日付。NULL＝止めるものが無い。お客様の画面（RPC）と予約のトリガー（GB009）が同じこれを呼ぶ。';

-- ============================================================
-- 4) 予約を止める（GB009）
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_booking_next_cycle_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor   UUID;
  v_plan    TEXT;
  v_cs      DATE;
  v_months  INT;
  v_unit    TEXT;
  v_target  DATE;
  v_ws      DATE;
  v_blocked DATE;
BEGIN
  -- 🔴 お客様が自分で取る予約だけを見る。店側の代理予約とサービスロールは素通し
  --    （GB003/GB004/GB006/GB007 と同じ非対称）
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 日時が変わらない UPDATE は見ない。'キャンセル済み' からの復活だけは例外
  -- （GB003/GB004 と同じ理由: キャンセル行を置いて別を取り、あとで復活させる抜け道）
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  v_blocked := public.member_first_unpaid_cycle_start(NEW.tenant_id, NEW.user_id);
  IF v_blocked IS NULL THEN
    RETURN NEW;
  END IF;

  -- この予約が属する窓の開始日を出す（窓の途中の日でも、頭で比べる）
  SELECT p.plan, p.cycle_start_date INTO v_plan, v_cs
    FROM public.profiles p WHERE p.user_id = NEW.user_id;
  SELECT tp.cycle_months, tp.cycle_unit INTO v_months, v_unit
    FROM public.tenant_plans tp
   WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = v_plan
   LIMIT 1;
  v_months := GREATEST(COALESCE(v_months, 1), 1);

  v_target := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
  SELECT w.window_start INTO v_ws
    FROM public.plan_cycle_window(v_cs, v_target, v_months, v_unit) w;

  IF v_ws >= v_blocked THEN
    RAISE EXCEPTION '次回分のお支払いの確認後にご予約いただけます'
      USING ERRCODE = 'GB009';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_booking_next_cycle_payment ON public.bookings;
CREATE TRIGGER trg_guard_booking_next_cycle_payment
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_next_cycle_payment();

-- ============================================================
-- 5) お客様の画面が読む口（SECURITY DEFINER）
-- ============================================================
-- 画面はこの1つの日付だけを見て、その日以降のカレンダーを選べなくする。
-- 読めなかったら NULL＝「止めるものは無い」に倒れる（予約が取れなくなるより安全）。
CREATE OR REPLACE FUNCTION public.get_my_next_cycle_payment_gate(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.member_first_unpaid_cycle_start(p_tenant_id, auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.get_my_next_cycle_payment_gate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_next_cycle_payment_gate(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_next_cycle_payment_gate(uuid) IS
  'ログイン中のお客様について「この日以降の予約には次回分の入金が要る」日付。NULL＝止めるものが無い。';

-- ============================================================
-- 6) 店側が「次回分」の窓を知る口
-- ============================================================
-- カルテのトグルに「次回分（10/25〜11/24）入金済み」と期間を出すため。
-- 何を確認したのかが押す前に分かる形にする（素の ON/OFF にしない）。
CREATE OR REPLACE FUNCTION public.get_member_next_cycle_gate(p_user_id uuid)
RETURNS TABLE (cycle_start date, cycle_end date, paid boolean, payment_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant  UUID;
  v_plan    TEXT;
  v_cs      DATE;
  v_ptype   TEXT;
  v_months  INT;
  v_unit    TEXT;
  v_today   DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_ws      DATE;
  v_we      DATE;
BEGIN
  -- 🔴 他人の user_id を渡して覗けないようにする。共通の番人を通す
  --    （`src/test/rpcCallerCheck.test.ts` が、user_id を受け取る RPC 全部を見張っている）。
  --    本人か、同じテナントの owner/trainer 以外は 42501 で落ちる。
  PERFORM public.assert_can_act_for(p_user_id);

  -- ⚠️ テナントは get_my_tenant_id() で引かない（LIMIT 1 なので、複数テナントに
  --    属するスタッフで取り違える）。自分と相手が**共に居るテナント**を突き合わせる。
  --    ここで role を owner/trainer に絞っているので、お客様が自分を渡しても 0 行になる
  --    （お客様向けの口は get_my_next_cycle_payment_gate のほう）。
  SELECT me.tenant_id INTO v_tenant
    FROM public.tenant_members me
    JOIN public.tenant_members target ON target.tenant_id = me.tenant_id
   WHERE me.user_id = auth.uid()
     AND me.status = 'active'
     AND me.role = ANY (ARRAY['owner', 'trainer'])
     AND target.user_id = p_user_id
     AND target.status = 'active'
   LIMIT 1;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT p.plan, p.cycle_start_date INTO v_plan, v_cs
    FROM public.profiles p WHERE p.user_id = p_user_id;
  IF v_plan IS NULL OR v_cs IS NULL THEN
    RETURN;
  END IF;

  SELECT tp.plan_type, tp.cycle_months, tp.cycle_unit INTO v_ptype, v_months, v_unit
    FROM public.tenant_plans tp
   WHERE tp.tenant_id = v_tenant AND tp.plan_name = v_plan
   LIMIT 1;
  IF COALESCE(v_ptype, 'subscription') <> 'subscription' THEN
    RETURN;
  END IF;
  v_months := GREATEST(COALESCE(v_months, 1), 1);

  -- 「次回分」＝今日の窓の次の窓。画面に出すのも、押して記録するのもこれ
  SELECT w.window_start, w.window_end INTO v_ws, v_we
    FROM public.plan_cycle_window(v_cs, v_today, v_months, v_unit) w;
  SELECT w.window_start, w.window_end INTO v_ws, v_we
    FROM public.plan_cycle_window(v_cs, v_we, v_months, v_unit) w;

  RETURN QUERY
    SELECT v_ws, v_we,
      EXISTS (SELECT 1 FROM public.member_payments mp
               WHERE mp.tenant_id = v_tenant AND mp.user_id = p_user_id
                 AND mp.covers_cycle_start = v_ws),
      (SELECT mp.id FROM public.member_payments mp
        WHERE mp.tenant_id = v_tenant AND mp.user_id = p_user_id
          AND mp.covers_cycle_start = v_ws
        LIMIT 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_member_next_cycle_gate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_next_cycle_gate(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_member_next_cycle_gate(uuid) IS
  'カルテの「次回分 入金済み」トグル用。そのお客様の次のサイクル窓と、そこへの入金があるか。ジム側（trainer）のみ。';
