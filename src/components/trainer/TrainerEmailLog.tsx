// 通知の送信履歴（ジム設定 → メール・通知）。
//
// なぜ要るか: お客様から「予約のメールが来ていない」と言われたとき、
// これまで店は**何も確認できなかった**。届いたのか・配信停止で止まったのか・
// そもそも送っていないのかが、こちらに問い合わせないと分からなかった。
//
// ⚠️ 認証メール（新規登録・パスワード再設定）はここに出ない。ジムに属さないので
//    tenant_id が NULL で、RLS が弾く（migration 20260826010000 のコメント参照）。

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, Send } from "lucide-react";
import { useTenant } from "@/hooks/useTenant";
import { formatJST } from "@/lib/timezone";
import { toast } from "sonner";
import {
  loadEmailLog, collapseLog, toneOf, resendEmail, LOG_PAGE,
  type EmailLogEntry, type EmailLogRow, type LogTone,
} from "@/lib/emailLog";

const ToneIcon = ({ tone }: { tone: LogTone }) => {
  if (tone === "ok") return <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />;
  if (tone === "bad") return <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
};

const TrainerEmailLog = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const fetchPage = async (offset: number) => {
    if (!tenant?.id) return;
    try {
      const page = await loadEmailLog(tenant.id, { offset });
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setMore(page.length === LOG_PAGE);
      setError(null);
    } catch (e) {
      // 🔴 空表示にしない。「履歴が無い」と「読めなかった」は店にとって別物で、
      //    取り違えると「送っていない」と誤解して二重に送る
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!tenant?.id) return;
    setLoading(true);
    void fetchPage(0).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  /**
   * もう一度送る。
   *
   * ⚠️ お客様に届くものなので、押す前に宛先を読み上げて確認する。
   *    履歴の一覧は行が詰まっていて、隣の行を押し間違えやすい。
   */
  const resend = async (e: EmailLogEntry) => {
    if (!tenant?.id) return;
    if (!window.confirm(t("emailLog.resendConfirm", { email: e.recipient_email }))) return;
    setResending(e.id);
    try {
      const r = await resendEmail(tenant.id, e.id);
      if (r.ok === true) {
        toast.success(t("emailLog.resendDone", { email: e.recipient_email }));
        await fetchPage(0);
        return;
      }
      const key =
        r.code === "no_payload" ? "emailLog.resendNoPayload"
        : r.code === "email_suppressed" ? "emailLog.resendSuppressed"
        : "emailLog.resendFailed";
      toast.error(t(key));
    } finally {
      setResending(null);
    }
  };

  const entries: EmailLogEntry[] = collapseLog(rows);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("emailLog.desc")}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={loading}
            onClick={() => { setLoading(true); void fetchPage(0).finally(() => setLoading(false)); }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("emailLog.refresh")}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
            <p className="text-xs text-destructive">{t("emailLog.loadFailed")}</p>
          </div>
        )}

        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 && !error ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{t("emailLog.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => {
              const tone = toneOf(e.status);
              return (
                <div key={e.id} className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5">
                  <ToneIcon tone={tone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-bold truncate">
                        {t(`emailLog.template.${e.template_name}`, { defaultValue: e.template_name })}
                      </p>
                      <Badge
                        variant="outline"
                        className={
                          tone === "ok" ? "text-[10px] px-1.5 py-0 h-4 text-accent border-accent/30"
                          : tone === "bad" ? "text-[10px] px-1.5 py-0 h-4 text-destructive border-destructive/30"
                          : "text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
                        }
                      >
                        {t(`emailLog.status.${e.status}`, { defaultValue: e.status })}
                      </Badge>
                      {e.attempts > 1 && (
                        <span className="text-[10px] text-muted-foreground">
                          {t("emailLog.attempts", { count: e.attempts })}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{e.recipient_email}</p>
                    {/* 失敗の理由は店が動く材料になるので隠さない */}
                    {tone === "bad" && e.error_message && (
                      <p className="text-[11px] text-destructive/80 break-all">{e.error_message}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatJST(e.created_at, "M/d HH:mm")}
                    </span>
                    {/* 届かなかったものだけ。届いたものに出すと誤って二重送信させる */}
                    {tone === "bad" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 gap-1 text-[10px]"
                        disabled={resending !== null}
                        onClick={() => void resend(e)}
                      >
                        {resending === e.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Send className="w-3 h-3" />}
                        {t("emailLog.resend")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

            {more && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void fetchPage(rows.length)}
              >
                {t("emailLog.loadMore")}
              </Button>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">{t("emailLog.authNote")}</p>
      </CardContent>
    </Card>
  );
};

export default TrainerEmailLog;
