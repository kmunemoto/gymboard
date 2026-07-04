-- 体験予約の「直接INSERT経路」を閉じる。
--
-- 背景: これまで公開予約サイトは anon キーで trial_bookings に直接 INSERT していた。
-- 予約作成を Edge Function trial-book に一本化したため、anon/authenticated の
-- INSERT 許可が残っていると trial-book の各検証 (営業枠グリッド・24時間/1ヶ月
-- ウィンドウ・回数制限・テナント実在確認) を迂回して任意の行を投入できてしまう。
-- trial-book は service_role で動作し RLS/GRANT をバイパスするため、公開経路を
-- 閉じても正規の予約作成には影響しない。トレーナーの soft-cancel は既存の
-- UPDATE ポリシー (authenticated) を使うため影響を受けない。
--
-- 冪等: DROP ... IF EXISTS / REVOKE は複数回実行しても安全。

-- 1) 許可用の PERMISSIVE INSERT ポリシーを削除 (これが無ければ RLS は既定で拒否)
DROP POLICY IF EXISTS "Guests can insert trial bookings" ON public.trial_bookings;
DROP POLICY IF EXISTS "Anyone can insert trial bookings" ON public.trial_bookings;

-- 2) 存在意義がなくなった RESTRICTIVE INSERT ポリシーも掃除 (残っても無害だが混乱防止)
DROP POLICY IF EXISTS tenant_isolation_insert ON public.trial_bookings;

-- 3) 権限レベルでも INSERT を遮断 (将来 PERMISSIVE ポリシーが誤って追加されても
--    穴が再び開かないようにする belt-and-braces)。service_role は GRANT をバイパス。
REVOKE INSERT ON public.trial_bookings FROM anon, authenticated;
