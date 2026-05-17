
ALTER TABLE public.equipment_items ADD COLUMN IF NOT EXISTS image_path text;

UPDATE public.equipment_items SET image_path = '/equipment/weapon_wooden_sword.png' WHERE item_key = 'wooden_sword';
UPDATE public.equipment_items SET image_path = '/equipment/weapon_goblin_blade.png' WHERE item_key = 'goblin_blade';
UPDATE public.equipment_items SET image_path = '/equipment/weapon_orc_axe.png' WHERE item_key = 'orc_axe';
UPDATE public.equipment_items SET image_path = '/equipment/weapon_dragon_fang.png' WHERE item_key = 'dragon_fang';
UPDATE public.equipment_items SET image_path = '/equipment/shield_leather.png' WHERE item_key = 'leather_shield';
UPDATE public.equipment_items SET image_path = '/equipment/shield_ice.png' WHERE item_key = 'ice_shield';
UPDATE public.equipment_items SET image_path = '/equipment/shield_flame.png' WHERE item_key = 'flame_guard';
UPDATE public.equipment_items SET image_path = '/equipment/shield_storm.png' WHERE item_key = 'storm_barrier';
UPDATE public.equipment_items SET image_path = '/equipment/amulet_stone.png' WHERE item_key = 'stone_amulet';
UPDATE public.equipment_items SET image_path = '/equipment/amulet_forest.png' WHERE item_key = 'forest_charm';
UPDATE public.equipment_items SET image_path = '/equipment/amulet_star.png' WHERE item_key = 'star_pendant';
UPDATE public.equipment_items SET image_path = '/equipment/amulet_crown.png' WHERE item_key = 'crown_of_light';
