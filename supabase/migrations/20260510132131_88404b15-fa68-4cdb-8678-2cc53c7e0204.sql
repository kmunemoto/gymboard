
ALTER TABLE public.equipment_items DROP CONSTRAINT IF EXISTS equipment_items_item_type_check;
ALTER TABLE public.equipment_items ADD CONSTRAINT equipment_items_item_type_check
  CHECK (item_type IN ('weapon','shield','amulet','accessory','top','bottom'));
