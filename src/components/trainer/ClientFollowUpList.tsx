import type { LucideIcon } from "lucide-react";
import { ChevronRight, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * ホーム画面の「声をかける相手」の一覧（見出し＋最大10件＋残り件数）。
 *
 * 「フォローが必要な顧客」と「次の予約待ち」の2つが同じ形なので1つにした。
 * 別々に書くと、片方だけメッセージボタンが無い・片方だけ件数が違う、になる。
 *
 * ⚠️ Tailwind は動的なクラス名を拾えないので、色は下の表に**文字列そのまま**で持つ。
 */
const TONE = {
  warning: { card: "border-warning/30", avatar: "bg-warning/15 text-warning", icon: "text-warning" },
  info: { card: "border-info/30", avatar: "bg-info/15 text-info", icon: "text-info" },
} as const;

export interface ClientFollowUpItem {
  user_id: string;
  name: string;
  /** 名前の下に出す1行（「最終来店から21日」など） */
  detail: string;
}

interface Props {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONE;
  badgeVariant: "destructive" | "secondary";
  items: readonly ClientFollowUpItem[];
  onSelectClient: (clientId: string) => void;
  onMessageClient?: (clientId: string) => void;
  testId?: string;
}

const SHOWN = 10;

const ClientFollowUpList = ({
  title, icon: Icon, tone, badgeVariant, items, onSelectClient, onMessageClient, testId,
}: Props) => {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const c = TONE[tone];
  return (
    <section data-testid={testId}>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${c.icon}`} />
        {title}
        <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 h-4 ml-1">
          {t("dashboard.countUnit", { count: items.length })}
        </Badge>
      </h2>
      <div className="space-y-2">
        {items.slice(0, SHOWN).map((item) => (
          <Card key={item.user_id} className={`card-hover cursor-pointer ${c.card}`} onClick={() => onSelectClient(item.user_id)}>
            <CardContent className="p-3 sm:p-4 flex items-center gap-3">
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 ${c.avatar}`}>
                {(item.name || "?")[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
              </div>
              {onMessageClient && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-8"
                  onClick={(e) => {
                    e.stopPropagation(); // 行タップ（顧客詳細）と分離
                    onMessageClient(item.user_id);
                  }}
                >
                  <MessageCircle className="w-3.5 h-3.5 mr-1" />
                  {t("retention.message")}
                </Button>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        ))}
        {items.length > SHOWN && (
          <p className="text-[11px] text-muted-foreground text-center pt-1">
            {t("retention.more", { count: items.length - SHOWN })}
          </p>
        )}
      </div>
    </section>
  );
};

export default ClientFollowUpList;
