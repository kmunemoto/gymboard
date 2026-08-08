-- 会員の「お金・契約・在籍状態」を扱えるようにする（2026-08-08）
--
-- ── なぜ要るか ────────────────────────────────────────────────
-- 2026-08-08 の棚卸しで、指導・予約・継続は充実している一方、
-- **経営の背骨（お金・契約・退会）が丸ごと無い**ことが分かった。
--
--   売上         定価 × サイクル開始日の推計。入金の実績ではない
--   入金         profiles.paid_this_month（boolean）だけ。しかも**書き込む UI が1つも無い**
--   回数券       残数（tenant_members.ticket_remaining）はあるが購入履歴が無い
--   在籍状態     tenant_members.status は 'active' のみ。休会が表現できない
--   退会         delete_customer_cascade でカルテごと物理削除する一択
--   契約・同意   記録する場所が存在しない
--   基本情報     電話番号・ふりがなの欄が無い
--
-- 1人ジム（自社の Salute御所南）は全部頭に入るので困らなかったが、
-- 本番には15テナントいる。他所のオーナーは会員の支払いを記憶できない。
--
-- ── このマイグレーションで足すもの ──────────────────────────
--   H-1  profiles           電話番号・ふりがな
--   H-2  tenant_members     休会（期間）・退会（日と理由）
--   D    member_payments    入金の実績（新規テーブル）
--   B    member_agreements  同意した記録（新規テーブル）
--   G    is_tenant_over_limit  退会者を席数に数えないよう修正


-- ===========================================================================
-- H-1. 顧客の基本情報（電話番号・ふりがな）
-- ===========================================================================
-- 「急な休みの連絡をしたいのに電話番号の欄が無く、結局スマホの連絡帳頼み」
-- という穴。人に紐づく情報なので tenant_members ではなく profiles に置く
-- （profiles の RLS は同テナントに絞られているので、他ジムからは見えない）。
--
-- ふりがなは並び順のため。漢字の display_name だけだと文字コード順になり、
-- 顧客一覧が五十音で並ばない。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone     text,
  ADD COLUMN IF NOT EXISTS name_kana text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_phone_len') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_phone_len CHECK (phone IS NULL OR char_length(phone) <= 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_name_kana_len') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_name_kana_len CHECK (name_kana IS NULL OR char_length(name_kana) <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.phone IS
  'お客様の電話番号（ジム側が入力する連絡先）。NULL なら未登録。';
COMMENT ON COLUMN public.profiles.name_kana IS
  'ふりがな。顧客一覧を五十音で並べるために使う。NULL なら display_name で並べる。';


-- ===========================================================================
-- H-2. 休会・退会
-- ===========================================================================
-- これまで status は 'active' しか入っていなかった。
-- 「産休で3ヶ月休む人」を表現できず、辞めた人は物理削除の一択だった。
--
--   active     在籍中
--   suspended  休会中（suspended_from 〜 suspended_until）
--   withdrawn  退会（withdrawn_on / withdrawal_reason）
--   cancelled  レガシー。is_tenant_over_limit が元から見ている値なので残す
--
-- ⚠️ **物理削除（delete_customer_cascade）は残してある。** 個人情報の削除請求に
--    応える手段が要るため。退会は「記録を残して在籍を終える」別の操作。

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS suspended_from    date,
  ADD COLUMN IF NOT EXISTS suspended_until   date,
  ADD COLUMN IF NOT EXISTS withdrawn_on      date,
  ADD COLUMN IF NOT EXISTS withdrawal_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_withdrawal_reason_len') THEN
    ALTER TABLE public.tenant_members
      ADD CONSTRAINT tenant_members_withdrawal_reason_len
      CHECK (withdrawal_reason IS NULL OR char_length(withdrawal_reason) <= 500);
  END IF;
  -- 休会期間は「開始 <= 終了」。終了が NULL なら無期限の休会。
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_suspend_range') THEN
    ALTER TABLE public.tenant_members
      ADD CONSTRAINT tenant_members_suspend_range
      CHECK (suspended_from IS NULL OR suspended_until IS NULL OR suspended_from <= suspended_until);
  END IF;
END $$;

-- status の CHECK は **既存データが全部この集合に収まっているときだけ** 付ける。
-- 本番に想定外の値が入っていた場合、制約追加でマイグレーション自体が失敗し、
-- 以降の文（入金テーブルの作成など）が全部流れなくなるため。
DO $$
DECLARE
  v_unknown int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_status_known') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_unknown
  FROM public.tenant_members
  WHERE status IS NOT NULL
    AND status NOT IN ('active', 'suspended', 'withdrawn', 'cancelled');
  IF v_unknown = 0 THEN
    ALTER TABLE public.tenant_members
      ADD CONSTRAINT tenant_members_status_known
      CHECK (status IS NULL OR status IN ('active', 'suspended', 'withdrawn', 'cancelled'));
  ELSE
    RAISE NOTICE '想定外の status が % 件あるため CHECK を付けませんでした。値を確認してから手で付けること。', v_unknown;
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_members.suspended_from IS  '休会の開始日。status=''suspended'' のときに使う。';
COMMENT ON COLUMN public.tenant_members.suspended_until IS '休会の終了予定日。NULL なら期限を決めていない休会。';
COMMENT ON COLUMN public.tenant_members.withdrawn_on IS    '退会日。status=''withdrawn'' のときに使う。';
COMMENT ON COLUMN public.tenant_members.withdrawal_reason IS
  '退会理由。離脱アラートは「辞めそうな人」を出すが、実際になぜ辞めたかはここにしか残らない。';

-- 退会・休会の検索用（顧客一覧は status で絞る）
CREATE INDEX IF NOT EXISTS tenant_members_tenant_status_idx
  ON public.tenant_members (tenant_id, status);


-- ===========================================================================
-- D. 入金の実績（新規テーブル）
-- ===========================================================================
-- profiles.paid_this_month（boolean）は書き込む UI が1つも無く、実質死んでいた。
-- 「今月払ったか」の1ビットでは、いくら・いつ・何の名目・どう受け取ったかが残らず、
-- 揉めたときの証拠にもならない。行として積む形にする。
--
-- ⚠️ **これは「記録」であって「決済」ではない。** アプリはお金を動かさない。
--    実際の集金（現金・振込・カード）はジムが従来どおり行い、その事実をここに残す。
--    アプリ内決済をやるなら Stripe Connect の加盟店審査が絡む別プロジェクト。

CREATE TABLE IF NOT EXISTS public.member_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  amount_yen  integer NOT NULL,
  paid_on     date NOT NULL,
  method      text NOT NULL,
  kind        text NOT NULL,
  -- 受け取った時点のプラン名を控える。あとでプラン名を変えても履歴が壊れないように
  -- （tenant_plans への参照ではなく文字列のスナップショット）。
  plan_name   text,
  note        text,
  recorded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payments_amount_range') THEN
    ALTER TABLE public.member_payments ADD CONSTRAINT member_payments_amount_range
      CHECK (amount_yen >= 0 AND amount_yen <= 10000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payments_method_known') THEN
    ALTER TABLE public.member_payments ADD CONSTRAINT member_payments_method_known
      CHECK (method IN ('現金', '銀行振込', 'クレジットカード', 'その他'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payments_kind_known') THEN
    ALTER TABLE public.member_payments ADD CONSTRAINT member_payments_kind_known
      CHECK (kind IN ('月謝', '回数券', '都度払い', '入会金', 'その他'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payments_note_len') THEN
    ALTER TABLE public.member_payments ADD CONSTRAINT member_payments_note_len
      CHECK (note IS NULL OR char_length(note) <= 500);
  END IF;
END $$;

-- 月次の売上集計（tenant_id + paid_on）と、顧客ごとの履歴（tenant_id + user_id）
CREATE INDEX IF NOT EXISTS member_payments_tenant_paid_idx
  ON public.member_payments (tenant_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS member_payments_tenant_user_idx
  ON public.member_payments (tenant_id, user_id, paid_on DESC);

ALTER TABLE public.member_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.member_payments;
CREATE POLICY tenant_isolation ON public.member_payments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- お客様は自分の入金履歴を見られる（「いつ・いくら払ったか」を本人が確認できる）。
-- ジム側スタッフは自テナント内を見られる。
DROP POLICY IF EXISTS member_payments_select ON public.member_payments;
CREATE POLICY member_payments_select ON public.member_payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'trainer'::app_role));

-- 🔴 記録できるのはジム側だけ。お客様が自分で「払った」と書けてはいけない。
DROP POLICY IF EXISTS member_payments_insert ON public.member_payments;
CREATE POLICY member_payments_insert ON public.member_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS member_payments_update ON public.member_payments;
CREATE POLICY member_payments_update ON public.member_payments
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS member_payments_delete ON public.member_payments;
CREATE POLICY member_payments_delete ON public.member_payments
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

COMMENT ON TABLE public.member_payments IS
  '会員からジムへの入金の記録。アプリは決済しない（現金・振込・カードで受け取った事実を残すだけ）。';


-- ===========================================================================
-- B. 同意した記録（新規テーブル）
-- ===========================================================================
-- 「入会時の同意書は紙で、既往歴の同意やキャンセル規定に同意した記録が残らない。
--   トラブったとき守ってくれるものが無い」という穴。
--
-- 電子署名まではやらない（法的要件が業種・規模で変わるため上流が決め打ちしない）。
-- 「何に・いつ同意したか」をジムが記録できるところまで。

CREATE TABLE IF NOT EXISTS public.member_agreements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  title       text NOT NULL,
  agreed_on   date NOT NULL,
  note        text,
  recorded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_agreements_title_len') THEN
    ALTER TABLE public.member_agreements ADD CONSTRAINT member_agreements_title_len
      CHECK (char_length(title) BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_agreements_note_len') THEN
    ALTER TABLE public.member_agreements ADD CONSTRAINT member_agreements_note_len
      CHECK (note IS NULL OR char_length(note) <= 1000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS member_agreements_tenant_user_idx
  ON public.member_agreements (tenant_id, user_id, agreed_on DESC);

ALTER TABLE public.member_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.member_agreements;
CREATE POLICY tenant_isolation ON public.member_agreements AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- お客様は自分が何に同意したかを見られる（見せられないと同意の記録として弱い）。
DROP POLICY IF EXISTS member_agreements_select ON public.member_agreements;
CREATE POLICY member_agreements_select ON public.member_agreements
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'trainer'::app_role));

-- 🔴 記録できるのはジム側だけ。
DROP POLICY IF EXISTS member_agreements_insert ON public.member_agreements;
CREATE POLICY member_agreements_insert ON public.member_agreements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS member_agreements_update ON public.member_agreements;
CREATE POLICY member_agreements_update ON public.member_agreements
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS member_agreements_delete ON public.member_agreements;
CREATE POLICY member_agreements_delete ON public.member_agreements
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

COMMENT ON TABLE public.member_agreements IS
  '会員が何にいつ同意したかの記録（利用規約・キャンセル規定・既往歴の申告など）。電子署名は含まない。';


-- ===========================================================================
-- G. 退会者を席数に数えない
-- ===========================================================================
-- 🔴 これを直さないと、**退会した人が席を食い続ける。**
--
-- is_tenant_over_limit は元から `status <> 'cancelled'` で数えていた。
-- 'withdrawn' を足しただけでは除外されず、退会させるほど上限に近づいてしまう。
--
-- ⚠️ **休会（suspended）は数える。** 席を確保したまま一時的に休んでいる状態であり、
--    ここを除外すると「全員を休会にすれば上限を回避できる」抜け道になる。
--
-- ⚠️ この関数は bookings / workouts / meals の BEFORE INSERT トリガーから呼ばれる。
--    ここで例外を出すとそのジムの業務が全面的に止まる（20260731000000 のコメント参照）。
--    ロジックを変えるときは「緩める方向」だけにすること。今回は除外を1つ増やす＝緩める側。
--
-- 🔴 **`status NOT IN (...)` のままにすること。`status IS NULL OR ...` を足さない。**
--    SQL の三値論理で、status が NULL の行は `status <> 'cancelled'` でも
--    `status NOT IN (...)` でも **偽になり、元から数えられていない**。
--    親切のつもりで `status IS NULL OR` を足すと、NULL の行が新たに数に入り、
--    人数が増える＝上限に近づく＝**予約もトレ記録も食事記録も通らなくなる**ジムが出る。
--    これは「締める方向」の変更で、ここでやってはいけない類の変更。
--    （実際 2026-08-08 の初稿でこれを書いてしまい、コミット前に気づいて直した）

CREATE OR REPLACE FUNCTION public.is_tenant_over_limit(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_customers INTEGER;
  v_max_trainers INTEGER;
  v_customers INTEGER;
  v_trainers INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT max_customers, max_trainers
    INTO v_max_customers, v_max_trainers
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF v_max_customers IS NOT NULL THEN
    SELECT COUNT(*) INTO v_customers
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND role = 'customer'
      AND status NOT IN ('cancelled', 'withdrawn');
    IF v_customers > v_max_customers THEN
      RETURN true;
    END IF;
  END IF;

  IF v_max_trainers IS NOT NULL THEN
    SELECT COUNT(*) INTO v_trainers
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND role = 'trainer'
      AND status NOT IN ('cancelled', 'withdrawn');
    IF v_trainers > v_max_trainers THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- ⚠️ CREATE OR REPLACE は ACL を保つが、念のため明示する。
-- **この関数の EXECUTE を authenticated から剥がさないこと。**
-- 剥がすとトリガー経由ではなく直接の呼び出しが 42501 で落ちる（穴8の教訓）。
GRANT EXECUTE ON FUNCTION public.is_tenant_over_limit(uuid) TO authenticated, anon;
