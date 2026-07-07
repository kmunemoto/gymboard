import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, CalendarX, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import GymLogo from "@/components/GymLogo";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface BookingSummary {
  guestName: string;
  gymName: string;
  date: string;
  time: string;
  alreadyCancelled: boolean;
  isPast: boolean;
  cancellable: boolean;
}

type Phase = "loading" | "confirm" | "cancelling" | "done" | "past" | "error";

const TrialCancel = () => {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<BookingSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  // 完了画面の見出しを「キャンセルしました」と「すでにキャンセル済み」で出し分ける
  const [wasAlready, setWasAlready] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!token) {
      setPhase("error");
      setErrorMsg(t("trialCancel.errInvalidLink"));
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("trial-cancel", {
        body: { token, action: "info" },
      });
      const result = data as { ok?: boolean; error?: string; booking?: BookingSummary } | null;
      if (error || !result?.ok || !result.booking) {
        setPhase("error");
        setErrorMsg(result?.error || t("trialCancel.errInvalidLink"));
        return;
      }
      setSummary(result.booking);
      if (result.booking.alreadyCancelled) {
        setWasAlready(true);
        setPhase("done");
      } else if (result.booking.isPast) {
        // 予約時間を過ぎた予約はセルフキャンセル対象外 (ジムへ直接連絡を案内)
        setPhase("past");
      } else {
        setPhase("confirm");
      }
    } catch (e) {
      console.error("Trial cancel info failed:", e);
      setPhase("error");
      setErrorMsg(t("trialCancel.errGeneric"));
    }
  }, [token, t]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleCancel = async () => {
    if (!token) return;
    setPhase("cancelling");
    try {
      const { data, error } = await supabase.functions.invoke("trial-cancel", {
        body: { token, action: "cancel" },
      });
      const result = data as
        | { ok?: boolean; error?: string; alreadyCancelled?: boolean; booking?: BookingSummary }
        | null;
      if (error || !result?.ok) {
        // 過去予約など業務上の拒否はエラーメッセージを表示して confirm に留める
        setErrorMsg(result?.error || t("trialCancel.errGeneric"));
        setPhase("confirm");
        return;
      }
      if (result.booking) setSummary(result.booking);
      setWasAlready(!!result.alreadyCancelled);
      setPhase("done");
    } catch (e) {
      console.error("Trial cancel failed:", e);
      setErrorMsg(t("trialCancel.errGeneric"));
      setPhase("confirm");
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md slide-up">
        <CardContent className="p-8 text-center space-y-5">{children}</CardContent>
      </Card>
    </div>
  );

  const GymFooter = () => (
    <div className="flex justify-center pt-2">
      <GymLogo size="sm" />
      {summary?.gymName && (
        <span className="ml-2 text-sm font-bold text-muted-foreground">{summary.gymName}</span>
      )}
    </div>
  );

  if (phase === "loading") {
    return (
      <Shell>
        <DumbbellLoader className="w-8 h-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">{t("trialCancel.loading")}</p>
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("trialCancel.errTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-2">{errorMsg}</p>
        </div>
        <GymFooter />
      </Shell>
    );
  }

  if (phase === "past") {
    return (
      <Shell>
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t("trialCancel.pastTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-2">{t("trialCancel.pastBody")}</p>
        </div>
        {summary && (
          <div className="bg-muted/50 rounded-xl p-4 space-y-1">
            <p className="text-sm font-bold">{summary.date}</p>
            <p className="text-sm">{summary.time}</p>
          </div>
        )}
        <GymFooter />
      </Shell>
    );
  }

  if (phase === "done") {
    return (
      <Shell>
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto">
          <Check className="w-8 h-8 text-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold">
            {wasAlready ? t("trialCancel.alreadyTitle") : t("trialCancel.doneTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {wasAlready ? t("trialCancel.alreadyBody") : t("trialCancel.doneBody")}
          </p>
        </div>
        {summary && (
          <div className="bg-muted/50 rounded-xl p-4 space-y-1">
            <p className="text-sm font-bold">{summary.date}</p>
            <p className="text-sm">{summary.time}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("trialCancel.doneRebook")}</p>
        <GymFooter />
      </Shell>
    );
  }

  // phase === "confirm" | "cancelling"
  return (
    <Shell>
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
        <CalendarX className="w-8 h-8 text-destructive" />
      </div>
      <div>
        <h1 className="text-xl font-bold">{t("trialCancel.confirmTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-2">{t("trialCancel.confirmBody")}</p>
      </div>

      {summary && (
        <div className="bg-accent/10 rounded-xl p-4 space-y-2 text-left">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="w-4 h-4 text-accent shrink-0" />
            <span className="font-bold">{summary.date}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-accent shrink-0" />
            <span>{summary.time}</span>
          </div>
        </div>
      )}

      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

      <div className="space-y-2">
        <Button
          variant="destructive"
          size="lg"
          className="w-full"
          onClick={handleCancel}
          disabled={phase === "cancelling"}
        >
          {phase === "cancelling" ? <DumbbellLoader className="w-4 h-4 mr-2" /> : null}
          {t("trialCancel.confirmButton")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("trialCancel.keepNote")}</p>
      </div>

      <GymFooter />
    </Shell>
  );
};

export default TrialCancel;
