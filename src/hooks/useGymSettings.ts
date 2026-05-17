import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface GymSettings {
  id: string;
  logo_url: string | null;
}

export const useGymSettings = () => {
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    const { data } = await supabase
      .from("gym_settings")
      .select("*")
      .limit(1)
      .single();
    if (data) setSettings(data as GymSettings);
    setLoading(false);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateLogoUrl = async (url: string | null) => {
    if (!settings) return;
    const { error } = await supabase
      .from("gym_settings")
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq("id", settings.id);
    if (!error) {
      setSettings({ ...settings, logo_url: url });
    }
    return error;
  };

  return { settings, loading, updateLogoUrl, refetch: fetchSettings };
};
