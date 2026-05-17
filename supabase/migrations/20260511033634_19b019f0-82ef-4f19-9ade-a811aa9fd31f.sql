CREATE OR REPLACE FUNCTION public.buy_stamina(p_user_id uuid, p_quantity int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price int := 100;
  v_total_cost int;
  v_coins int;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RETURN jsonb_build_object('error', '数量が不正です');
  END IF;
  v_total_cost := v_price * p_quantity;
  SELECT coins INTO v_coins FROM public.user_avatars WHERE user_id = p_user_id;
  IF v_coins IS NULL OR v_coins < v_total_cost THEN
    RETURN jsonb_build_object('error', 'コインが足りません');
  END IF;
  UPDATE public.user_avatars SET coins = coins - v_total_cost WHERE user_id = p_user_id;
  INSERT INTO public.user_stamina (user_id, current_stamina, max_stamina, last_recovery_at)
  VALUES (p_user_id, p_quantity, 5, now())
  ON CONFLICT (user_id) DO UPDATE
    SET current_stamina = public.user_stamina.current_stamina + p_quantity,
        updated_at = now();
  RETURN jsonb_build_object(
    'success', true,
    'quantity', p_quantity,
    'cost', v_total_cost,
    'remaining_coins', v_coins - v_total_cost
  );
END; $$;