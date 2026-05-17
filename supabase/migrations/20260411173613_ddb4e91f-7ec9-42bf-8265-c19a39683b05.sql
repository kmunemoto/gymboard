-- Allow users to delete their own meals
CREATE POLICY "Users can delete own meals"
ON public.meals
FOR DELETE
USING (auth.uid() = user_id);

-- Allow trainers to delete any meals
CREATE POLICY "Trainers can delete any meals"
ON public.meals
FOR DELETE
USING (has_role(auth.uid(), 'trainer'::app_role));
