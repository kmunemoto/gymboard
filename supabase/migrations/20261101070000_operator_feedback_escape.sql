-- ============================================================================
-- 運営への要望メールに、ジム名・表示名が HTML のまま入っていた穴を塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大
-- operator-feedback-1 / notify-operator-feedback-1（反証役が「通る」と判断）。
--
-- ■ 何が起きていたか
-- 設定の「運営への要望」を送ると、operator_feedback の AFTER INSERT トリガー（notify_operator_feedback）が
-- 運営（宗本さん）宛てのメールを noreply@notify.kyoto-salute.com から積む。本文（NEW.body）はエスケープしていたが、
-- 「店舗:」「送信者:」に入るジム名（tenants.gym_name）と表示名（profiles.display_name）は生のまま HTML に入り、
-- 差出人の表示名にもジム名をそのまま使っていた。ジムは誰でも開けるので、ジム名を
--   <a href="https://evil.example/">【Stripe】お支払い方法の更新が必要です</a>
-- にして要望を1件送るだけで、自社ドメインから運営者の受信箱へ、偽のボタン付きのメールを「Stripe」の名前で届けられた。
-- 運営者のアカウント（Lovable / Supabase / Stripe / GitHub）は全ジムの全データに届く鍵なので、フィッシングの踏み台になる。
--
-- ■ 直し方（本番の pg_get_functiondef から写し、次の3つだけ変える）
-- 1. HTML に入れる値（本文・ジム名・表示名）は & < > " ' の5つをエスケープする（本文は " ' を足しただけ）
-- 2. 差出人の表示名は固定の「運営への要望」（ジム名は件名と本文で分かる）
-- 3. 件名に入れるジム名・表示名は、改行を空白にする（ヘッダーに改行を入れさせない）
-- テキスト版（text）はもともと HTML として描かれないので、そのまま。1時間あたりの上限・REVOKE もそのまま。
--
-- 見張り: src/test/operatorFeedbackEscape.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_operator_feedback()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_to     CONSTANT TEXT := 'k.munemoto@kyoto-salute.com';
  v_domain CONSTANT TEXT := 'notify.kyoto-salute.com';
  v_gym       TEXT;
  v_sender    TEXT;
  v_recent    INT;
  v_body_html TEXT;
  v_gym_html    TEXT;
  v_sender_html TEXT;
  v_unsub     TEXT;
  v_msg_id    TEXT := gen_random_uuid()::text;
BEGIN
  BEGIN
    SELECT count(*) INTO v_recent
      FROM public.operator_feedback
     WHERE user_id = NEW.user_id
       AND created_at > now() - interval '1 hour';
    IF v_recent > 5 THEN
      RETURN NEW;
    END IF;

    SELECT gym_name INTO v_gym FROM public.tenants WHERE id = NEW.tenant_id;
    SELECT display_name INTO v_sender FROM public.profiles WHERE user_id = NEW.user_id;

    -- 🔴 HTML に入れる値は全部エスケープする（ジム名・表示名も。誰でもジムを開けて、好きな名前にできる）
    v_body_html := replace(replace(replace(replace(replace(NEW.body,
                     '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
    v_body_html := replace(v_body_html, E'\n', '<br>');
    v_gym_html := replace(replace(replace(replace(replace(coalesce(v_gym, '-'),
                     '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
    v_sender_html := replace(replace(replace(replace(replace(coalesce(v_sender, '-'),
                     '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');

    SELECT token INTO v_unsub
      FROM public.email_unsubscribe_tokens WHERE email = lower(v_to);
    IF v_unsub IS NULL THEN
      INSERT INTO public.email_unsubscribe_tokens (token, email)
      VALUES (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
              lower(v_to))
      ON CONFLICT (email) DO NOTHING;
      SELECT token INTO v_unsub
        FROM public.email_unsubscribe_tokens WHERE email = lower(v_to);
    END IF;

    PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id',      v_msg_id,
      'idempotency_key', v_msg_id,
      'to',              v_to,
      -- 差出人の表示名は固定（ジム名にすると「Stripe」などを名乗れる）
      'from',            '運営への要望 <noreply@' || v_domain || '>',
      'sender_domain',   v_domain,
      'subject',         '【要望】' || regexp_replace(coalesce(v_gym, '(店舗名なし)'), '[\r\n]+', ' ', 'g')
                           || ' / ' || regexp_replace(coalesce(v_sender, '(名前未設定)'), '[\r\n]+', ' ', 'g'),
      'html',            '<p><b>店舗:</b> ' || v_gym_html
                           || '<br><b>送信者:</b> ' || v_sender_html
                           || '</p><hr><p>' || v_body_html || '</p>',
      'text',            '店舗: ' || coalesce(v_gym, '-')
                           || E'\n送信者: ' || coalesce(v_sender, '-')
                           || E'\n\n' || NEW.body,
      'purpose',         'transactional',
      'label',           'operator-feedback',
      'unsubscribe_token', v_unsub,
      'queued_at',       now()
    ));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'operator_feedback: メール通知に失敗（行は保存済み）: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
