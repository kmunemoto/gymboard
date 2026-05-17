
-- 1. Extend profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT '月4回',
  ADD COLUMN IF NOT EXISTS paid_this_month BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_completed BOOLEAN NOT NULL DEFAULT false;

-- 2. Add trainer SELECT/UPDATE policies on profiles
CREATE POLICY "Trainers can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can update all profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

-- 3. Exercises master table
CREATE TABLE public.exercises (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'その他',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view exercises"
  ON public.exercises FOR SELECT TO authenticated USING (true);
CREATE POLICY "Trainers can insert exercises"
  ON public.exercises FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'));
CREATE POLICY "Trainers can update exercises"
  ON public.exercises FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));
CREATE POLICY "Trainers can delete exercises"
  ON public.exercises FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

-- 4. Workouts table
CREATE TABLE public.workouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  workout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight NUMERIC,
  reps INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workouts"
  ON public.workouts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Trainers can view all workouts"
  ON public.workouts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));
CREATE POLICY "Users can insert own workouts"
  ON public.workouts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Trainers can insert any workouts"
  ON public.workouts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'));
CREATE POLICY "Trainers can update any workouts"
  ON public.workouts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

-- 5. Bookings table
CREATE TABLE public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  booking_date TIMESTAMPTZ NOT NULL,
  booking_type TEXT NOT NULL DEFAULT '通常',
  status TEXT NOT NULL DEFAULT '予約済み',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Trainers can view all bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));
CREATE POLICY "Users can insert own bookings"
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Trainers can update any bookings"
  ON public.bookings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));
CREATE POLICY "Users can delete own bookings"
  ON public.bookings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 6. Notification settings table
CREATE TABLE public.notification_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  reminder_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification settings"
  ON public.notification_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notification settings"
  ON public.notification_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notification settings"
  ON public.notification_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Trigger for updated_at on notification_settings
CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_workouts_user_id ON public.workouts(user_id);
CREATE INDEX idx_workouts_exercise_id ON public.workouts(exercise_id);
CREATE INDEX idx_bookings_user_id ON public.bookings(user_id);
CREATE INDEX idx_bookings_date ON public.bookings(booking_date);
