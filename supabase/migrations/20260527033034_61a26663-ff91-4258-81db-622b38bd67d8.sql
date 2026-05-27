
-- Tighten meals DELETE policies: restrict to authenticated role (not public)
DROP POLICY IF EXISTS "Trainers can delete any meals" ON public.meals;
DROP POLICY IF EXISTS "Users can delete own meals" ON public.meals;

CREATE POLICY "Trainers can delete any meals"
ON public.meals FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users can delete own meals"
ON public.meals FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Explicit service_role-only write policies for server-managed tables
CREATE POLICY "Service role manages rival_battles"
ON public.rival_battles FOR ALL TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages user_gacha_tickets"
ON public.user_gacha_tickets FOR ALL TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages user_quest_stage_completions"
ON public.user_quest_stage_completions FOR ALL TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
