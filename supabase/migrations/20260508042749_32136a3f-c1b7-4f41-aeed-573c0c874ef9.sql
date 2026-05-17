
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  icon text NOT NULL DEFAULT 'Bell',
  target text NOT NULL DEFAULT 'all',
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_announcements_published_at ON public.announcements(published_at DESC);
CREATE INDEX idx_announcements_target ON public.announcements(target);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own/all announcements"
ON public.announcements FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'trainer'::app_role)
  OR (
    published_at <= now()
    AND (target = 'all' OR target = auth.uid()::text)
  )
);

CREATE POLICY "Trainers insert announcements"
ON public.announcements FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers update announcements"
ON public.announcements FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers delete announcements"
ON public.announcements FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE TABLE public.announcement_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, announcement_id)
);

CREATE INDEX idx_announcement_reads_user ON public.announcement_reads(user_id);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own reads"
ON public.announcement_reads FOR SELECT TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users insert own reads"
ON public.announcement_reads FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Seed initial announcements
INSERT INTO public.announcements (title, body, icon, target, published_at) VALUES
('アバター育成システムが登場！',
'トレーニングするたびにEXPが貯まり、アバターが成長します！

【基本システム】
トレーニング1回で+100 EXP
連続来店でコンボボーナス（最大2倍）
レベルが上がるとガチャ確率UP＆レイドダメージ倍率UP

【やりこみ要素】
デイリーミッション：毎日3つのミッションに挑戦
実績バッジ：全41種類をコレクション
称号：条件を満たすと獲得、装備して自慢しよう
ガチャ：トレーニングごとにチケット1枚、コインやEXPが当たる

設定画面からアバターの性別や髪色も変更できます！',
'Sparkles', 'all', now()),
('5/18〜 初のレイドボスが出現！',
'5月18日（日）〜24日（土）の1週間、ジム初のレイドボスが出現します！

【レイドボスとは？】
ジム全体の総挙上量でボスのHPを削る協力イベントです。
あなたのトレーニングが、そのままボスへのダメージになります。

【レベルが高いほど有利！】
ルーキー：ダメージ1.0倍
レギュラー：ダメージ1.2倍
アスリート：ダメージ1.5倍
エリート：ダメージ1.8倍
レジェンド：ダメージ2.0倍

【撃破報酬】
ボスを倒すと参加者全員にEXPとコインの報酬があります。
みんなでチカラを合わせて倒しましょう！

ホーム画面のRAID BOSSカードで出現までのカウントダウンを確認できます。',
'Swords', 'all', now());
