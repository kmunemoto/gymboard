-- メッセージへのリアクション（2026-08-12）
--
-- ## なぜ要るか
--
-- 「返信するほどではないが、読んだと伝えたい」が言えない。いまは
-- 「ありがとうございます」だけの吹き出しが並ぶか、既読だけで済ませるかの二択。
-- 既読は**開いただけでも付く**ので、「見た」と「受け取った」の区別がない。
--
-- ## 🔴 通知は鳴らさない
--
-- リアクションは `messages` の INSERT ではないので、`notify_new_message`
-- トリガーの対象外。**プッシュは飛ばない。**
-- 気軽に押せることが価値なので、ここに通知を足さないこと
-- （足すと「リアクションで相手の携帯が鳴る」＝押しづらくなる）。
--
-- ## 🔴 絵文字は使わない
--
-- このリポジトリの規約は「アイコンは Lucide React のみ。絵文字は使わない」。
-- LINE のような絵文字ではなく**固定4種のキー**を持ち、描画側が Lucide の
-- アイコンに割り当てる。DB には種別のキーだけを入れる。
--
-- ## 見える範囲
--
-- そのメッセージを読める人＝会話の当事者とジムのスタッフ。
-- `messages` の SELECT ポリシーに**乗せる**（EXISTS で引く）ことで、
-- リアクション側に判定を二重に書かない。片方だけ直して食い違うのを避ける。

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  -- 固定4種。増やすときはクライアントのアイコン割り当ても一緒に増やすこと。
  kind       TEXT NOT NULL,
  tenant_id  UUID REFERENCES public.tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同じ人が同じメッセージに同じ種別を2回付けない。
  -- 付け外しは INSERT / DELETE で表す（トグル）。
  CONSTRAINT message_reactions_unique UNIQUE (message_id, user_id, kind),
  CONSTRAINT message_reactions_kind_known
    CHECK (kind IN ('thumbsUp', 'heart', 'check', 'smile'))
);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON public.message_reactions (message_id);

COMMENT ON TABLE public.message_reactions IS
  'メッセージへのリアクション。kind は固定4種（絵文字ではなく Lucide アイコンのキー）。'
  '通知は鳴らさない（messages の INSERT ではないのでトリガーの対象外）。';

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- 既存のテーブルと同じ形の RESTRICTIVE なテナント分離。
DROP POLICY IF EXISTS tenant_isolation ON public.message_reactions;
CREATE POLICY tenant_isolation ON public.message_reactions AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 🔴 見える範囲は messages の見える範囲に**そのまま乗せる**。
--    ここに独自の条件を書くと、messages 側を直したときに食い違う。
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_reactions.message_id
         AND (
           auth.uid() = m.sender_id
           OR auth.uid() = m.receiver_id
           OR public.has_role(auth.uid(), 'trainer'::app_role)
         )
    )
  );

-- 付けられるのは**自分の分だけ**、かつ**自分が読めるメッセージにだけ**。
--
-- ⚠️ user_id のチェックを外すと、他人の名前でリアクションを付けられる。
DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_reactions.message_id
         AND (
           auth.uid() = m.sender_id
           OR auth.uid() = m.receiver_id
           OR public.has_role(auth.uid(), 'trainer'::app_role)
         )
    )
  );

-- 外せるのは自分が付けた分だけ。
-- 🔴 trainer だからといって他人のリアクションを消せてはいけない
--    （has_role(trainer) は**テナント横断のグローバルロール**）。
DROP POLICY IF EXISTS message_reactions_delete ON public.message_reactions;
CREATE POLICY message_reactions_delete ON public.message_reactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- UPDATE は要らない。付け替えは DELETE + INSERT。
-- 権限としても渡さない（種別だけ書き換えられる経路を作らない）。
REVOKE UPDATE ON public.message_reactions FROM authenticated, anon;
