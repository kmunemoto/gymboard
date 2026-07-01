-- 課金システムを一旦無効化（無料・無制限）。いつでも復活できるようにする。
--
-- 背景:
--   ジム側サブスク（GymBoard SaaS）の実強制は enforce_tenant_plan_limit トリガーが
--   担っており、席数上限(is_tenant_over_limit)・サブスク延滞(is_tenant_subscription_blocked)の
--   いずれかに該当すると、新規の予約・記録作成をサーバー側で拒否していた。
--
-- 方針:
--   トリガー関数を「素通り(RETURN NEW)」にし、上記のブロックを一切かけない。
--   判定関数 is_tenant_over_limit / is_tenant_subscription_blocked は削除せず温存する
--   （復活時にそのまま使えるように）。会員向けの回数制限（月◯回など）は別ロジックのため
--   影響しない。
--
-- 復活方法（いつでも戻せる）:
--   下記の「復活用」ブロック（コメントアウト済み）を有効化したマイグレーションを1本
--   追加するだけ。あわせてクライアント側 src/lib/featureFlags.ts の
--   BILLING_ENABLED を true に戻す。

CREATE OR REPLACE FUNCTION public.enforce_tenant_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- [課金無効化中] 席数上限・サブスク延滞によるブロックを解除（無料・無制限）。
  -- 判定関数（is_tenant_over_limit / is_tenant_subscription_blocked）は温存＝復活用。
  RETURN NEW;
END;
$$;

-- ============================================================
-- 復活用（billing を元に戻すとき、この内容で enforce_tenant_plan_limit を再定義する）:
--
-- CREATE OR REPLACE FUNCTION public.enforce_tenant_plan_limit()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- BEGIN
--   IF NEW.tenant_id IS NOT NULL THEN
--     IF public.is_tenant_over_limit(NEW.tenant_id) THEN
--       RAISE EXCEPTION 'プランの上限を超えているため、この操作はできません。プランをアップグレードするか、顧客数を上限以下にしてください。'
--         USING ERRCODE = 'check_violation';
--     END IF;
--     IF public.is_tenant_subscription_blocked(NEW.tenant_id) THEN
--       RAISE EXCEPTION 'サブスクリプションが有効ではありません。お支払い状況をご確認のうえ、プランを有効化してください。'
--         USING ERRCODE = 'check_violation';
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- ============================================================
