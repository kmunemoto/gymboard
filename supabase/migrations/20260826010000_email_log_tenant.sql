-- 通知の送信履歴を店に見せる（2026-08-26）
--
-- ## いまの困りごと
--
-- お客様から「予約のメールが来ていない」と言われたとき、**店は何も確認できない**。
-- `email_send_log` は service_role からしか読めず（ポリシーは3本とも
-- `auth.role() = 'service_role'`）、しかも**どのジムの通知なのかを持っていない**。
-- 結果、届いたのか・配信停止で止まったのか・そもそも送っていないのかが、
-- こちらに問い合わせないと分からない状態だった。
--
-- ## やること
--
-- 1. `tenant_id` を足す（どのジムの通知か）
-- 2. そのジムのスタッフが自分のぶんだけ読めるポリシーを足す
-- 3. 過去ぶんは宛先メールから引き当ててバックフィルする
--
-- ⚠️ 認証メール（signup / recovery 等）はジムに属さないので `tenant_id` は NULL のまま。
--    ポリシーが tenant_id を必須にしているので、**NULL の行は誰にも見えない**
--    （service_role だけが読める＝今までどおり）。これは意図した挙動。

-- ---------------------------------------------------------------------------
-- 1. 列
-- ---------------------------------------------------------------------------

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.email_send_log.tenant_id IS
  'どのジムの通知か。認証メール（ジムに属さない）は NULL。NULL の行はスタッフからは見えない。';

-- 履歴画面は「このジムの新しい順」でしか引かない
CREATE INDEX IF NOT EXISTS email_send_log_tenant_created_idx
  ON public.email_send_log (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

-- 顧客ごとの絞り込み（カルテから「この人宛の履歴」を見る用）
CREATE INDEX IF NOT EXISTS email_send_log_tenant_recipient_idx
  ON public.email_send_log (tenant_id, recipient_email)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. 読み取りのポリシー
-- ---------------------------------------------------------------------------

-- 🔴 tenant_id が NULL の行を絶対に通さないこと。
--    `has_tenant_role(NULL, ...)` は false になるので式としては安全だが、
--    ここを `OR tenant_id IS NULL` のように緩めると、**全ジムの認証メールの
--    宛先アドレスが全スタッフに見える**。
CREATE POLICY "Tenant staff can read own send log"
  ON public.email_send_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
  );

-- ---------------------------------------------------------------------------
-- 3. 過去ぶんのバックフィル
-- ---------------------------------------------------------------------------

-- 宛先のメールアドレスから、そのアドレスの持ち主が在籍しているジムを引く。
--
-- ⚠️ **2つ以上のジムに在籍している人がいたら、その行は埋めない。**
--    どちらのジムの通知か決められないため。埋めてしまうと、他ジムのスタッフに
--    そのお客様への通知履歴が見えることになる（取り違えの実害はこちら側が重い）。
--    本番では複数在籍の人は現在いないが、将来を含めて条件で守る。
--
-- 体験予約・ドロップインの宛先はアカウントを持たないので引き当たらない。
-- 埋まらなかった行は NULL のまま＝スタッフからは見えない（従来どおり）。
UPDATE public.email_send_log l
   SET tenant_id = m.tenant_id
  FROM (
    SELECT lower(u.email) AS email, min(tm.tenant_id) AS tenant_id
      FROM auth.users u
      JOIN public.tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
     WHERE u.email IS NOT NULL
     GROUP BY lower(u.email)
    HAVING count(DISTINCT tm.tenant_id) = 1
  ) m
 WHERE l.tenant_id IS NULL
   AND lower(l.recipient_email) = m.email;
