import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { filterCustomersByName } from "@/lib/bookingOptionAccess";

/**
 * 限定のオプションを「選べるお客様」を選ぶ（2026-10-26・src/lib/bookingOptionAccess.ts）。
 *
 * 呼び出し側は**開いているときだけ描く**。お客様一覧の読み込みは、ここを開いたときだけ走らせる
 * （設定画面を開くたびに全員分を読みに行かない）。
 *
 * 決定しても DB にはまだ書かない。オプションの「保存」で、ほかの項目と一緒に書く。
 */
interface Props {
  optionName: string;
  selected: ReadonlyArray<string>;
  onDone: (userIds: string[]) => void;
  onClose: () => void;
}

const BookingOptionCustomersDialog = ({ optionName, selected, onDone, onClose }: Props) => {
  const { t } = useTranslation();
  const { profiles, loading } = useAllCustomerProfiles();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(() => [...selected]);
  const shown = useMemo(() => filterCustomersByName(profiles, query), [profiles, query]);

  const toggle = (userId: string) =>
    setPicked((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>
            {t("bookingOptions.customersDialogTitle", { name: optionName.trim() || t("bookingOptions.untitled") })}
          </DialogTitle>
          <DialogDescription>{t("bookingOptions.customersDialogDesc")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="h-10 pl-8"
            value={query}
            placeholder={t("bookingOptions.customersSearch")}
            aria-label={t("bookingOptions.customersSearch")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("bookingOptions.restrictedCount", { count: picked.length })}</p>
        <div className="flex-1 min-h-[120px] overflow-y-auto space-y-1.5" data-testid="option-customers-list">
          {loading ? (
            <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
          ) : shown.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("bookingOptions.customersEmpty")}</p>
          ) : (
            shown.map((p) => (
              <label
                key={p.user_id}
                className={`flex items-center gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                  picked.includes(p.user_id) ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <Checkbox checked={picked.includes(p.user_id)} onCheckedChange={() => toggle(p.user_id)} />
                <span className="text-sm break-words">{p.display_name || t("bookingOptions.customerNoName")}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>{t("common.cancel")}</Button>
          <Button className="flex-1" onClick={() => onDone(picked)}>{t("bookingOptions.customersDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BookingOptionCustomersDialog;
