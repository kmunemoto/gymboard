
ALTER TABLE public.dungeon_monsters
  ADD COLUMN IF NOT EXISTS monster_level int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS monster_count int NOT NULL DEFAULT 1;

ALTER TABLE public.dungeon_stages
  ADD COLUMN IF NOT EXISTS recommended_level_min int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recommended_level_max int DEFAULT 99;

ALTER TABLE public.battle_items
  ADD COLUMN IF NOT EXISTS shop_price int;

INSERT INTO public.battle_items (item_key, item_name, effect_type, effect_amount, description, shop_price, icon_name) VALUES
('healing_herb_plus', '上いやしの草', 'heal_hp', 80, 'HPを80回復する上質な薬草', 30, 'Leaf'),
('star_water_plus', '上星のしずく', 'heal_mp', 50, 'MPを50回復する上質な聖水', 50, 'Droplet')
ON CONFLICT (item_key) DO NOTHING;

UPDATE public.battle_items SET shop_price = 10 WHERE item_key = 'healing_herb';
UPDATE public.battle_items SET shop_price = 20 WHERE item_key = 'star_water';
UPDATE public.battle_items SET shop_price = 100 WHERE item_key = 'revival_leaf';

CREATE OR REPLACE FUNCTION public.buy_shop_item(p_user_id uuid, p_item_key text, p_quantity int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
  v_coins int;
  v_total_cost int;
BEGIN
  SELECT * INTO v_item FROM public.battle_items WHERE item_key = p_item_key AND shop_price IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'このアイテムは販売していません');
  END IF;
  v_total_cost := v_item.shop_price * p_quantity;
  SELECT coins INTO v_coins FROM public.user_avatars WHERE user_id = p_user_id;
  IF v_coins IS NULL OR v_coins < v_total_cost THEN
    RETURN jsonb_build_object('error', 'コインが足りません');
  END IF;
  UPDATE public.user_avatars SET coins = coins - v_total_cost WHERE user_id = p_user_id;
  INSERT INTO public.user_battle_items (user_id, item_key, quantity)
  VALUES (p_user_id, p_item_key, p_quantity)
  ON CONFLICT (user_id, item_key) DO UPDATE SET quantity = user_battle_items.quantity + p_quantity;
  RETURN jsonb_build_object(
    'success', true,
    'item_name', v_item.item_name,
    'quantity', p_quantity,
    'cost', v_total_cost,
    'remaining_coins', v_coins - v_total_cost
  );
END; $$;

CREATE OR REPLACE FUNCTION public.buy_gacha_ticket(p_user_id uuid, p_quantity int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price int := 200;
  v_total_cost int;
  v_coins int;
BEGIN
  v_total_cost := v_price * p_quantity;
  SELECT coins INTO v_coins FROM public.user_avatars WHERE user_id = p_user_id;
  IF v_coins IS NULL OR v_coins < v_total_cost THEN
    RETURN jsonb_build_object('error', 'コインが足りません');
  END IF;
  UPDATE public.user_avatars SET coins = coins - v_total_cost WHERE user_id = p_user_id;
  FOR i IN 1..p_quantity LOOP
    INSERT INTO public.user_gacha_tickets (user_id) VALUES (p_user_id);
  END LOOP;
  RETURN jsonb_build_object(
    'success', true,
    'quantity', p_quantity,
    'cost', v_total_cost,
    'remaining_coins', v_coins - v_total_cost
  );
END; $$;
