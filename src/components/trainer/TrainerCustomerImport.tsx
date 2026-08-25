// 顧客をCSVで一括登録する画面（ジム設定 → データの書き出し・取り込み）。
//
// なぜ要るか: 他のジムから乗り換えてもらうとき、名簿を1人ずつ手で入れるのは現実的でない。
// ここが無いと「試しに使ってみる」の入口で止まる。
//
// ⚠️ 取り込むと**その人のアカウントが作られる**（ログイン手段は無い）。
//    通知は一切飛ばない。本人に届くのは、店が別途「招待」を送ったときだけ。
//    仕組みの理由は supabase/migrations/20260825010000_customer_import.sql の冒頭。
//
// ⚠️ 書き出しと同じくネイティブでは使わない。ファイルはパソコンにあるのが普通で、
//    WebView のファイル選択は端末ごとに挙動が違うため、案内を出して Web に寄せる。

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileUp, Info, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { isNative } from "@/lib/nativeBridge";
import { PRODUCTION_WEB_ORIGIN } from "@/lib/brand";
import { MEMBER_STATUS_LABEL } from "@/lib/memberLifecycle";
import {
  decodeCsvBytes,
  parseCustomerCsv,
  importableRows,
  IMPORT_FIELDS,
  IMPORT_FIELD_ORDER,
  type ImportIssue,
  type ImportRow,
} from "@/lib/csvImport";
import { loadExistingCustomers, loadPlanNames, runImport } from "@/lib/gymDataImport";

/** 画面に出す行数の上限。全部出すと数百行のテーブルになって確認できない。 */
const PREVIEW_LIMIT = 30;

const TrainerCustomerImport = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [missingName, setMissingName] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const native = isNative();

  const issueText = (i: ImportIssue) => t(`dataImport.issue.${i.code}`, { value: i.value ?? "" });

  const reset = () => {
    setRows(null);
    setMissingName(false);
    setFileName("");
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    if (!tenant?.id) return;
    setReading(true);
    try {
      const [existing, plans] = await Promise.all([
        loadExistingCustomers(tenant.id),
        loadPlanNames(tenant.id),
      ]);
      const text = decodeCsvBytes(await file.arrayBuffer());
      const parsed = parseCustomerCsv(text, existing, plans);
      setFileName(file.name);
      setMissingName(parsed.missingFields.includes("display_name"));
      setRows(parsed.rows);
    } catch (e) {
      console.error("CSV import: failed to read", e);
      toast.error(t("dataImport.readFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
      reset();
    } finally {
      setReading(false);
    }
  };

  const handleImport = async () => {
    if (!tenant?.id || !rows) return;
    const targets = importableRows(rows);
    if (targets.length === 0) return;

    setSending(true);
    setProgress(0);
    try {
      const result = await runImport(tenant.id, targets, (p) => setProgress(p.done));
      if (result.error) {
        toast.error(t("dataImport.failed", { count: result.imported }), {
          description: result.error,
        });
      } else {
        toast.success(t("dataImport.done", { count: result.imported }));
        reset();
      }
      // 一覧を持っている画面に作り直させる
      window.dispatchEvent(new CustomEvent("profile-updated"));
    } finally {
      setSending(false);
    }
  };

  const ok = rows ? importableRows(rows) : [];
  const skipped = rows?.filter((r) => r.duplicate && r.errors.length === 0) ?? [];
  const failed = rows?.filter((r) => r.errors.length > 0) ?? [];
  const problems = rows?.filter((r) => r.errors.length > 0 || r.warnings.length > 0) ?? [];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">{t("dataImport.desc")}</p>

        {/* 取り込むと何が起きるかを、押す前に必ず出す */}
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{t("dataImport.noEmailNote")}</p>
        </div>

        {native ? (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {t("dataExport.nativeHint", { url: PRODUCTION_WEB_ORIGIN })}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <p className="text-[11px] text-muted-foreground">{t("dataImport.columnsLabel")}</p>
              <p className="text-[11px] text-muted-foreground">
                {IMPORT_FIELD_ORDER.map((f) => IMPORT_FIELDS[f][0]).join(" / ")}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("dataImport.columnsNote")}</p>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={reading || sending}
                onClick={() => fileRef.current?.click()}
              >
                {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
                {t("dataImport.choose")}
              </Button>
              {fileName && <span className="text-[11px] text-muted-foreground truncate">{fileName}</span>}
            </div>
          </>
        )}

        {missingName && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
            <p className="text-xs text-destructive">{t("dataImport.noNameColumn")}</p>
          </div>
        )}

        {rows && !missingName && (
          <div className="space-y-3">
            {/* 何件入って何件とばすかを、押す前に数字で見せる */}
            <div className="grid grid-cols-3 gap-2">
              <Summary label={t("dataImport.countNew")} value={ok.length} tone="accent" />
              <Summary label={t("dataImport.countSkip")} value={skipped.length} tone="muted" />
              <Summary label={t("dataImport.countError")} value={failed.length} tone="destructive" />
            </div>

            {problems.length > 0 && (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-[11px]">
                  <tbody>
                    {problems.slice(0, PREVIEW_LIMIT).map((r) => (
                      <tr key={r.line} className="border-b last:border-b-0">
                        <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap align-top">
                          {t("dataImport.line", { line: r.line })}
                        </td>
                        <td className="px-2 py-1.5 font-bold align-top max-w-[10rem] truncate">
                          {r.display_name || "—"}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {r.errors.map((e, i) => (
                            <p key={`e${i}`} className="text-destructive">{issueText(e)}</p>
                          ))}
                          {r.warnings.map((w, i) => (
                            <p key={`w${i}`} className="text-muted-foreground">{issueText(w)}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {problems.length > PREVIEW_LIMIT && (
                  <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    {t("dataImport.andMore", { count: problems.length - PREVIEW_LIMIT })}
                  </p>
                )}
              </div>
            )}

            {ok.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {t("dataImport.statusPreview", {
                  detail: summarizeStatuses(ok),
                })}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={ok.length === 0 || sending}
                onClick={handleImport}
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {sending
                  ? t("dataImport.sending", { done: progress, total: ok.length })
                  : t("dataImport.submit", { count: ok.length })}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={reset}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/** 在籍状態の内訳。「全部が在籍中になっていないか」を押す前に気づけるようにする。 */
const summarizeStatuses = (rows: readonly ImportRow[]): string => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts.entries()]
    .map(([s, n]) => `${MEMBER_STATUS_LABEL[s as keyof typeof MEMBER_STATUS_LABEL]} ${n}`)
    .join(" / ");
};

const Summary = ({ label, value, tone }: { label: string; value: number; tone: "accent" | "muted" | "destructive" }) => (
  <div className="rounded-lg bg-muted/40 p-2 text-center">
    <p
      className={
        tone === "accent" ? "text-lg font-bold text-accent"
          : tone === "destructive" ? "text-lg font-bold text-destructive"
          : "text-lg font-bold text-muted-foreground"
      }
    >
      {value}
    </p>
    <p className="text-[10px] text-muted-foreground">{label}</p>
  </div>
);

export default TrainerCustomerImport;
