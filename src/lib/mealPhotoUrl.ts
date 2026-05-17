import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves a meal image_url to a displayable URL.
 * - Old records store full public URLs → returned as-is
 * - New records store storage paths like "userId/filename.jpg" → signed URL generated
 */
export async function getMealPhotoUrl(imageUrl: string): Promise<string> {
  // If it's already a full URL, return as-is (backward compat)
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  // Otherwise it's a storage path — create a signed URL (1 hour)
  const { data, error } = await supabase.storage
    .from("meal-photos")
    .createSignedUrl(imageUrl, 3600);

  if (error || !data?.signedUrl) {
    console.error("Failed to create signed URL for meal photo:", error);
    return imageUrl; // fallback
  }

  return data.signedUrl;
}

/**
 * Resolves multiple meal photo URLs in parallel
 */
export async function resolveMealPhotoUrls<T extends { image_url: string }>(
  meals: T[]
): Promise<(T & { resolved_image_url: string })[]> {
  const results = await Promise.all(
    meals.map(async (meal) => ({
      ...meal,
      resolved_image_url: await getMealPhotoUrl(meal.image_url),
    }))
  );
  return results;
}
