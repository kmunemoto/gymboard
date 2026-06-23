// TrainerClientDetail とその子コンポーネントで共有するデータモデル型。
export interface SetEntry {
  weight: string;
  reps: string;
}

export interface ExerciseEntry {
  exerciseId: string;
  name: string;
  sets: SetEntry[];
}

export interface ExerciseMaster {
  id: string;
  name: string;
  category: string;
}

export interface WorkoutRecord {
  id: string;
  workout_date: string;
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  sets: { set: number; weight: number; reps: number }[] | null;
  exercise_name?: string;
  notes?: string | null;
}

export interface MealRecord {
  id: string;
  image_url: string;
  resolved_image_url?: string;
  meal_type: string;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
  feedback: string | null;
  analyzed: boolean;
  created_at: string;
}
