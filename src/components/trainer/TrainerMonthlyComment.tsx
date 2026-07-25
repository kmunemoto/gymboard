import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfMonth, subMonths } from "date-fns";
import { ja } from "date-fns/locale";
import { getJSTNow } from "@/lib/timezone";
import { formatDate } from "@/lib/dateFormat";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface Props {
  clientId: string;
}

const TrainerMonthlyComment = ({ clientId }: Props) => {
  const { t } = useTranslation();
  const now = getJSTNow();
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = startOfMonth(subMonths(now, i));
    return { value: format(d, "yyyy-MM-dd"), label: formatDate(d, "yearMonth") };
  });

  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value);
  const [comment, setComment] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("monthly_reports")
        .select("*")
        .eq("user_id", clientId)
        .eq("month", selectedMonth)
        .maybeSingle();
      if (data) {
        setComment((data as any).trainer_comment || "");
        setExistingId((data as any).id);
      } else {
        setComment("");
        setExistingId(null);
      }
      setLoading(false);
    };
    fetch();
  }, [clientId, selectedMonth]);

  const handleSave = async () => {
    setSaving(true);
    if (existingId) {
      const { error } = await supabase
        .from("monthly_reports")
        .update({ trainer_comment: comment } as any)
        .eq("id", existingId);
      if (error) { toast.error(t("monthlyComment.saveFailed")); setSaving(false); return; }
    } else {
      const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
      const tenantId = await fetchMyTenantId();
      const { error, data } = await supabase
        .from("monthly_reports")
        .insert(withTenant({ user_id: clientId, month: selectedMonth, trainer_comment: comment }, tenantId) as any)
        .select()
        .single();
      if (error) { toast.error(t("monthlyComment.saveFailed")); setSaving(false); return; }
      if (data) setExistingId((data as any).id);
    }
    toast.success(t("monthlyComment.saved"));
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" />
        {t("monthlyComment.title")}
      </h2>

      <Select value={selectedMonth} onValueChange={setSelectedMonth}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="flex justify-center py-8">
          <DumbbellLoader className="w-5 h-5 text-accent" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Textarea
              placeholder={t("monthlyComment.placeholder")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <Button onClick={handleSave} disabled={saving || !comment.trim()} className="w-full">
              {saving ? <DumbbellLoader className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              {existingId ? t("monthlyComment.update") : t("monthlyComment.save")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TrainerMonthlyComment;
