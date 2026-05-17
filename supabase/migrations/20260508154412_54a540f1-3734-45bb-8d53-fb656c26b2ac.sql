
-- Trigger: on workout insert, automatically apply quest battle damage
CREATE OR REPLACE FUNCTION public.trigger_quest_battle_on_workout()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_volume NUMERIC := 0;
BEGIN
  IF NEW.sets IS NOT NULL AND jsonb_typeof(NEW.sets) = 'array' AND jsonb_array_length(NEW.sets) > 0 THEN
    SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
    INTO v_volume FROM jsonb_array_elements(NEW.sets) s;
  ELSE
    v_volume := COALESCE(NEW.weight,0) * COALESCE(NEW.reps,0);
  END IF;

  IF v_volume > 0 THEN
    BEGIN
      PERFORM public.execute_quest_battle(NEW.user_id, v_volume);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'quest battle trigger failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quest_battle_on_workout ON public.workouts;
CREATE TRIGGER trg_quest_battle_on_workout
AFTER INSERT ON public.workouts
FOR EACH ROW EXECUTE FUNCTION public.trigger_quest_battle_on_workout();
