INSERT INTO public.avatar_customization_items (item_key, name, category, price, rarity, sort_order)
VALUES ('black', 'ブラック', 'hair_color', 30, 'common', 10)
ON CONFLICT DO NOTHING;