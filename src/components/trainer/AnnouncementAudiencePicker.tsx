import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { filterCustomersByName } from "@/lib/bookingOptionAccess";
import type { AudienceMode } from "@/lib/announcementAudience";

/**
 * お知らせの配信対象（全員／全員から除く／個別）を選ぶ（2026-10-27・src/lib/announcementAudience.ts）。
 *
 * お知らせの入力画面は自前の重ね表示（z-[60]）なので、ダイアログを重ねずにその場で選ばせる。
 * 決めても DB にはまだ書かない。「配信」「更新」で、ほかの項目と一緒に書く。
 */
interface Customer {
  user_id: string;
  display_name: string | null;
  name_kana?: string | null;
}

interface Props {
  mode: AudienceMode;
  onModeChange: (mode: AudienceMode) => void;
  selected: ReadonlyArray<string>;
  onChange: (userIds: string[]) => void;
  customers: ReadonlyArray<Customer>;
}

const MODES: { mode: AudienceMode; labelKey: string }[] = [
  { mode: "all", labelKey: "announcement.targetAll" },
  { mode: "except", labelKey: "announcement.targetExcept" },
  { mode: "only", labelKey: "announcement.targetIndividual" },
];

const AnnouncementAudiencePicker = ({ mode, onModeChange, selected, onChange, customers }: Props) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterCustomersByName(customers, query), [customers, query]);
  const nameOf = (userId: string) =>
    customers.find((c) => c.user_id === userId)?.display_name || t("announcement.customerNoName");

  const toggle = (userId: string) =>
    onChange(selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId]);

  return (
    <div className="space-y-1.5">
      <Label>{t("announcement.fieldTarget")}</Label>
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <Button
            key={m.mode}
            type="button"
            size="sm"
            variant={mode === m.mode ? "default" : "outline"}
            aria-pressed={mode === m.mode}
            onClick={() => onModeChange(m.mode)}
          >
            {t(m.labelKey)}
          </Button>
        ))}
      </div>
      {mode !== "all" && (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-2.5" data-testid="announcement-audience">
          <p className="text-xs text-muted-foreground">
            {t(mode === "except" ? "announcement.exceptHint" : "announcement.onlyHint")}
          </p>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="announcement-audience-selected">
              {selected.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs">
                  <span className="max-w-[10rem] truncate">{nameOf(id)}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-primary/20"
                    aria-label={t("announcement.audienceRemove", { name: nameOf(id) })}
                    onClick={() => toggle(id)}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="h-9 pl-8"
              value={query}
              placeholder={t("announcement.audienceSearch")}
              aria-label={t("announcement.audienceSearch")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("announcement.audienceCount", { count: selected.length })}</p>
          <div className="max-h-52 overflow-y-auto space-y-1" data-testid="announcement-audience-list">
            {shown.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("announcement.audienceEmpty")}</p>
            ) : (
              shown.map((c) => (
                <label
                  key={c.user_id}
                  className={`flex items-center gap-2.5 rounded-md border p-2 cursor-pointer transition-colors ${
                    selected.includes(c.user_id) ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <Checkbox checked={selected.includes(c.user_id)} onCheckedChange={() => toggle(c.user_id)} />
                  <span className="text-sm break-words">{c.display_name || t("announcement.customerNoName")}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnouncementAudiencePicker;
