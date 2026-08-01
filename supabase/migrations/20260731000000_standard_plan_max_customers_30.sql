-- GymBoard SaaS の Standard プラン（¥6,980/月）の顧客上限を 50名 → 30名 に変更する。
-- 料金は据え置きで、変わるのは顧客数の上限のみ。
--
-- なぜマイグレーションが要るか:
--   tenants.max_customers は gymboard_plan から導出される値ではなく、**保存された列**
--   （20260517093130_*.sql:28 `max_customers INTEGER DEFAULT 5`）。
--   書き込むのは Stripe Webhook（gymboard-stripe-webhook が _shared/gymboard-plans.ts の
--   PLAN_MAP を見て tenants.max_customers に焼き込む）だけで、次の課金イベントが飛ぶまで
--   古い値が残る。そして上限judgeはどれも「保存された値」を読む:
--     - enforce_tenant_member_limits（20260523143956_*.sql:24-31、`>=` で顧客追加を拒否）
--     - is_tenant_over_limit（20260525025614_*.sql:25-31、`>` で超過判定）
--   したがってコード側だけ 30 にしても、既存の Standard テナントは 50 のまま運用され続ける。
--
-- 顧客数ガード（`<= 30`）を付けている理由（重要・消さないこと）:
--   is_tenant_over_limit は enforce_tenant_plan_limit から呼ばれ、これは
--   bookings / workouts / meals の BEFORE INSERT トリガー（20260525025614_*.sql:69-80）。
--   つまり 31〜50名を抱える Standard テナントの上限をいきなり 30 に下げると、
--   「新規入会が止まる」だけでなく **予約・トレーニング記録・食事記録が一切作れなくなる**
--   ＝そのジムが全面的に業務停止する。落ち度のない課金中のお客様にそれは起こせない。
--   そのため 30名以下に収まっているテナントだけを対象にし、31名以上のテナントは
--   意図的に 50 のまま据え置く（＝実質グランドファザリング）。個別対応が要るときは
--   このファイル末尾の調査SQLで洗い出すこと。
--
-- 冪等性: `max_customers = 50` を条件に含めているので再実行しても二重適用にならない。
--   手動で調整済みのテナント（NULL の無制限枠や 999 などのコンプ枠）にも触れない。
--   Salute御所南（ceda19b0-d5e0-4928-ab2e-996a0b823af4）は premium / max_customers NULL
--   （20260528010545_*.sql）のため対象外。
--
-- 2026-07-31 適用時点では gymboard_plan='standard' のテナントは0件のため、この UPDATE は
-- 0行更新（no-op）。Webhook 再デプロイまでの間に Standard 契約が発生した場合の保険として残す。

UPDATE public.tenants t
   SET max_customers = 30,
       updated_at = now()
 WHERE t.gymboard_plan = 'standard'
   AND t.max_customers = 50
   AND (
     SELECT COUNT(*)
       FROM public.tenant_members m
      WHERE m.tenant_id = t.id
        AND m.role = 'customer'
        AND m.status <> 'cancelled'
   ) <= 30;

-- 据え置き（31名以上）になった Standard テナントの洗い出し用:
--   SELECT t.id, t.gym_name, COUNT(m.*) AS customers
--     FROM public.tenants t
--     JOIN public.tenant_members m
--       ON m.tenant_id = t.id AND m.role = 'customer' AND m.status <> 'cancelled'
--    WHERE t.gymboard_plan = 'standard' AND t.max_customers = 50
--    GROUP BY t.id, t.gym_name
--   HAVING COUNT(m.*) > 30;
