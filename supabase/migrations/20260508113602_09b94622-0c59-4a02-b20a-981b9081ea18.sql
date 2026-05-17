
-- Customization items master
CREATE TABLE IF NOT EXISTS public.avatar_customization_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key text NOT NULL UNIQUE,
  category text NOT NULL,
  name text NOT NULL,
  price integer NOT NULL DEFAULT 0,
  rarity text NOT NULL DEFAULT 'common',
  required_level integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.avatar_customization_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated views customization items"
ON public.avatar_customization_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Trainers manage customization items insert"
ON public.avatar_customization_items FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage customization items update"
ON public.avatar_customization_items FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage customization items delete"
ON public.avatar_customization_items FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

-- Owned items per user
CREATE TABLE IF NOT EXISTS public.user_customization_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key)
);

ALTER TABLE public.user_customization_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own customization items"
ON public.user_customization_items FOR SELECT TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users insert own customization items"
ON public.user_customization_items FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- Add equipped_emote column
ALTER TABLE public.user_avatars
ADD COLUMN IF NOT EXISTS equipped_emote text;

-- Purchase RPC
CREATE OR REPLACE FUNCTION public.purchase_customization_item(p_item_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item record;
  v_coins integer;
  v_already boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '認証が必要です';
  END IF;

  SELECT * INTO v_item FROM public.avatar_customization_items WHERE item_key = p_item_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'アイテムが見つかりません'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_customization_items
    WHERE user_id = v_user_id AND item_key = p_item_key
  ) INTO v_already;

  IF v_already THEN
    -- Already owned: just (re)equip if applicable
    IF v_item.category = 'emote' THEN
      UPDATE public.user_avatars SET equipped_emote = p_item_key, updated_at = now()
      WHERE user_id = v_user_id;
    END IF;
    RETURN jsonb_build_object('already_owned', true, 'equipped', true);
  END IF;

  SELECT coins INTO v_coins FROM public.user_avatars WHERE user_id = v_user_id FOR UPDATE;
  IF v_coins IS NULL OR v_coins < v_item.price THEN
    RAISE EXCEPTION 'コインが足りません';
  END IF;

  UPDATE public.user_avatars
  SET coins = coins - v_item.price, updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_customization_items (user_id, item_key)
  VALUES (v_user_id, p_item_key);

  IF v_item.category = 'emote' THEN
    UPDATE public.user_avatars
    SET equipped_emote = p_item_key, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'already_owned', false,
    'equipped', v_item.category = 'emote',
    'remaining_coins', v_coins - v_item.price
  );
END;
$$;

-- Seed emote items
INSERT INTO public.avatar_customization_items (item_key, category, name, price, rarity, required_level, sort_order)
VALUES
  ('emote_gutspose',  'emote', 'ガッツポーズ',       20, 'common', 0, 1),
  ('emote_muscle',    'emote', 'マッスルポーズ',     30, 'common', 0, 2),
  ('emote_shake',     'emote', 'プロテインシェイク', 30, 'common', 0, 3),
  ('emote_exhausted', 'emote', 'ヘトヘト',           20, 'common', 0, 4)
ON CONFLICT (item_key) DO UPDATE
SET category = EXCLUDED.category, name = EXCLUDED.name, price = EXCLUDED.price,
    rarity = EXCLUDED.rarity, sort_order = EXCLUDED.sort_order;
