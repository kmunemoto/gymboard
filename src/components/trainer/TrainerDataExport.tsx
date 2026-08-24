// ジムのデータを CSV で書き出す画面（ジム設定 → データの書き出し）。
//
// なぜ要るか: SaaS として他のジムに導入してもらうとき、「自分のデータをいつでも
// 持ち出せる」ことが導入の判断材料になる。乗り換え時の移行先としても使う。
//
// ⚠️ ネイティブ（iOS/Android アプリ）ではファイルのダウンロードができない
//    （WebView が <a download> を無視する）。プラグインを足せば可能だが
//    ネイティブの作り直しが要るので、いまは**ブラウザで開いてもらう案内**を出す。

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, Info } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { isNative } from "@/lib/nativeBridge";
import { PRODUCTION_WEB_ORIGIN } from "@/lib/brand";
import { getJSTToday } from "@/lib/timezone";
import { toCsv, downloadCsv, buildCsvFilename } from "@/lib/csvExport";
import { EXPORT_KINDS, loadExport, type ExportKind } from "@/lib/gymDataExport";

const TrainerDataExport = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const native = isNative();

  const handleExport = async (kind: ExportKind) => {
    if (!tenant?.id) return;
    setBusy(kind);
    try {
      const { rows, columns } = await loadExport(kind, tenant.id);
      if (rows.length === 0) {
        // 0件でもヘッダーだけのファイルは落とす。「空だった」と分かるほうが親切
        toast.info(t("dataExport.emptyNotice"));
      }
      const csv = toCsv(rows as never[], columns);
      const filename = buildCsvFilename(t(`dataExport.kind.${kind}`), tenant.gym_name, getJSTToday());
      downloadCsv(filename, csv);
      toast.success(t("dataExport.done", { count: rows.length }));
    } catch (e) {
      console.error("CSV export failed:", e);
      toast.error(t("dataExport.failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">{t("dataExport.desc")}</p>

        {native && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {t("dataExport.nativeHint", { url: PRODUCTION_WEB_ORIGIN })}
            </p>
          </div>
        )}

        <div className="space-y-2">
          {EXPORT_KINDS.map((kind) => (
            <div key={kind} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm">{t(`dataExport.kind.${kind}`)}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {t(`dataExport.kindDesc.${kind}`)}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 h-9 gap-1.5"
                disabled={busy !== null || !tenant || native}
                onClick={() => handleExport(kind)}
              >
                <Download className="w-3.5 h-3.5" />
                {busy === kind ? t("common.processing") : t("dataExport.download")}
              </Button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">{t("dataExport.excelNote")}</p>
      </CardContent>
    </Card>
  );
};

export default TrainerDataExport;
