import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, MailX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type Status = "loading" | "valid" | "already" | "invalid" | "success" | "error";

const Unsubscribe = () => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${token}`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.valid === false && d.reason === "already_unsubscribed") setStatus("already");
        else if (d.valid) setStatus("valid");
        else setStatus("invalid");
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const { data } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
      setStatus(data?.success ? "success" : "error");
    } catch {
      setStatus("error");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          {status === "loading" && <DumbbellLoader className="w-8 h-8 mx-auto text-muted-foreground" />}
          {status === "valid" && (
            <>
              <MailX className="w-10 h-10 mx-auto text-muted-foreground" />
              <h1 className="text-lg font-bold">{t("unsubscribe.titlePrompt")}</h1>
              <p className="text-sm text-muted-foreground">{t("unsubscribe.promptBody")}</p>
              <Button onClick={handleUnsubscribe} disabled={submitting} className="w-full">
                {submitting && <DumbbellLoader className="w-4 h-4 mr-2" />}
                {t("unsubscribe.submit")}
              </Button>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="w-10 h-10 mx-auto text-success" />
              <h1 className="text-lg font-bold">{t("unsubscribe.titleSuccess")}</h1>
              <p className="text-sm text-muted-foreground">{t("unsubscribe.successBody")}</p>
            </>
          )}
          {status === "already" && (
            <>
              <CheckCircle className="w-10 h-10 mx-auto text-muted-foreground" />
              <h1 className="text-lg font-bold">{t("unsubscribe.titleAlready")}</h1>
              <p className="text-sm text-muted-foreground">{t("unsubscribe.alreadyBody")}</p>
            </>
          )}
          {(status === "invalid" || status === "error") && (
            <>
              <XCircle className="w-10 h-10 mx-auto text-destructive" />
              <h1 className="text-lg font-bold">{t("unsubscribe.titleError")}</h1>
              <p className="text-sm text-muted-foreground">{t("unsubscribe.errorBody")}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Unsubscribe;
