import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { canSendFeedback, FEEDBACK_MAX_LEN } from "@/lib/operatorFeedback";
import { toast } from "sonner";

interface OperatorFeedbackProps {
  /** 所属テナント。無い（読み込み前など）間は送信ボタンを無効にする */
  tenantId: string | null;
}

interface FeedbackRow {
  id: string;
  body: string;
  created_at: string;
}

/**
 * 「運営への要望」。店側の設定画面から、開発元（運営）へ要望を直接送る欄。
 *
 * 送信は operator_feedback への INSERT だけ。メール通知は DB のトリガーが
 * 既存のメールキュー経由で行う（migrations/20260814010000）。
 * クライアントは Edge Function を呼ばない＝ここが壊れる要素はテーブルだけ。
 *
 * 履歴は「自分が送った分」だけ表示する（RLS もそうなっている）。
 * 同じ店の他のスタッフの要望は見えない。
 */
const OperatorFeedback = ({ tenantId }: OperatorFeedbackProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<FeedbackRow[]>([]);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("operator_feedback" as never)
      .select("id, body, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    if (!error && data) setHistory(data as unknown as FeedbackRow[]);
  }, [user]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleSend = async () => {
    if (!user || !tenantId || !canSendFeedback(body)) return;
    setSending(true);
    try {
      const { error } = await supabase.from("operator_feedback" as never).insert({
        tenant_id: tenantId,
        user_id: user.id,
        body: body.trim(),
      } as never);
      if (error) throw error;
      toast.success(t("operatorFeedback.sent"));
      setBody("");
      void loadHistory();
    } catch (e) {
      console.error("要望の送信に失敗:", e);
      toast.error(t("operatorFeedback.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Lightbulb className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{t("operatorFeedback.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("operatorFeedback.desc")}</p>
          </div>
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("operatorFeedback.placeholder")}
          rows={4}
          maxLength={FEEDBACK_MAX_LEN}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {body.trim().length} / {FEEDBACK_MAX_LEN}
          </span>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || !tenantId || !canSendFeedback(body)}
          >
            <Send className="w-4 h-4 mr-1" />
            {sending ? t("common.processing") : t("operatorFeedback.send")}
          </Button>
        </div>

        {history.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t("operatorFeedback.history")}
            </p>
            {history.map((f) => (
              <div key={f.id} className="rounded-xl border border-border p-3">
                <p className="text-[10px] text-muted-foreground">
                  {new Date(f.created_at).toLocaleDateString()}
                </p>
                <p className="text-xs whitespace-pre-wrap break-words line-clamp-3">{f.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OperatorFeedback;
