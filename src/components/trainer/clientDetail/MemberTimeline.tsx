// 活動タイムライン（カルテの概要タブ）。
//
// なぜ要るか: カルテはタブが7本あり、来店・記録・測定・入金・同意が別々の場所にある。
// セッション前に「前回いつ来て、何をして、体重はどうで、入金は済んでいるか」を
// 知りたいのに、**4回タブを行き来しないと分からない**。ここで1本にする。
//
// ⚠️ 追加ではなく**集約**。元のタブは残す（詳しく見る・編集するのはそちら）。

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarCheck2, CalendarX2, Dumbbell, Scale, JapaneseYen, FileCheck2, Camera,
  Loader2, History,
} from "lucide-react";
import { formatJST } from "@/lib/timezone";
import { loadTimeline } from "@/lib/memberTimelineData";
import { groupByDay, type TimelineEvent, type TimelineKind } from "@/lib/memberTimeline";

/** 最初に見せる日数。全部出すと概要タブが長くなりすぎる。 */
const INITIAL_DAYS = 5;

const ICONS: Record<TimelineKind, typeof Dumbbell> = {
  booking: CalendarCheck2,
  cancelled: CalendarX2,
  workout: Dumbbell,
  measurement: Scale,
  payment: JapaneseYen,
  agreement: FileCheck2,
  photo: Camera,
};

/** 種類ごとの色。キャンセルだけ弱める（起きなかったことなので） */
const TONE: Record<TimelineKind, string> = {
  booking: "text-accent",
  cancelled: "text-muted-foreground/60",
  workout: "text-primary",
  measurement: "text-primary",
  payment: "text-accent",
  agreement: "text-muted-foreground",
  photo: "text-muted-foreground",
};

interface Props {
  tenantId: string | null | undefined;
  clientId: string;
  /** 記録や入金を保存したときに作り直すためのキー */
  refreshKey?: number;
}

const MemberTimeline = ({ tenantId, clientId, refreshKey }: Props) => {
  const { t } = useTranslation();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!tenantId || !clientId) return;
    let cancelled = false;
    setLoading(true);
    void loadTimeline({ tenantId, userId: clientId })
      .then((e) => { if (!cancelled) setEvents(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, clientId, refreshKey]);

  const days = groupByDay(events);
  const shown = expanded ? days : days.slice(0, INITIAL_DAYS);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <History className="w-4 h-4 text-accent" />
          {t("timeline.section")}
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : days.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{t("timeline.empty")}</p>
        ) : (
          <div className="space-y-3">
            {shown.map((d) => (
              <div key={d.day} className="space-y-1.5">
                <p className="text-[11px] font-bold text-muted-foreground tabular-nums">
                  {formatJST(`${d.day}T00:00:00+09:00`, "yyyy年M月d日（E）")}
                </p>
                <div className="space-y-1 pl-1 border-l-2 border-muted">
                  {d.events.map((e) => {
                    const Icon = ICONS[e.kind];
                    return (
                      <div key={e.id} className="flex items-start gap-2 pl-2">
                        <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${TONE[e.kind]}`} />
                        <div className="min-w-0">
                          <p className="text-xs">
                            {t(e.labelKey, e.labelValues as Record<string, unknown>)}
                          </p>
                          {e.detail && (
                            <p className="text-[11px] text-muted-foreground truncate">{e.detail}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {days.length > INITIAL_DAYS && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t("timeline.collapse") : t("timeline.expand", { count: days.length - INITIAL_DAYS })}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MemberTimeline;
