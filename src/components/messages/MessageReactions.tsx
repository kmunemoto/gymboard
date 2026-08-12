import { useTranslation } from "react-i18next";
import { ThumbsUp, Heart, Check, Smile } from "lucide-react";
import {
  REACTION_KINDS,
  summarize,
  type Reaction,
  type ReactionKind,
} from "@/lib/messageReaction";

/**
 * 種別 → Lucide アイコン。
 *
 * 🔴 絵文字は使わない（このリポジトリの規約）。DB には種別のキーだけが入る。
 */
export const REACTION_ICONS: Record<ReactionKind, typeof ThumbsUp> = {
  thumbsUp: ThumbsUp,
  heart: Heart,
  check: Check,
  smile: Smile,
};

interface MessageReactionsProps {
  reactions: Reaction[];
  currentUserId: string | null | undefined;
  onToggle: (kind: ReactionKind) => void;
  /** 自分の吹き出しの側に出すか（並びを寄せる） */
  alignEnd?: boolean;
}

/**
 * 吹き出しの下に出すリアクションのチップ。
 *
 * ⚠️ 0件の種別は出さない。4つ常時並べると会話が記号だらけになる。
 *    付けるのは長押しメニューから（`MessageActions`）。
 */
const MessageReactions = ({
  reactions,
  currentUserId,
  onToggle,
  alignEnd = false,
}: MessageReactionsProps) => {
  const { t } = useTranslation();
  const summary = summarize(reactions, currentUserId);
  if (summary.length === 0) return null;

  return (
    <div className={`flex gap-1 mt-1 ${alignEnd ? "justify-end" : "justify-start"}`}>
      {summary.map(({ kind, count, mine }) => {
        const Icon = REACTION_ICONS[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={mine}
            aria-label={t(`chat.reaction.${kind}`)}
            className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums transition-colors ${
              mine
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon className="w-3 h-3" />
            {count}
          </button>
        );
      })}
    </div>
  );
};

/** 長押しメニューに出す「付ける」側の並び。4種を常に出す。 */
export const ReactionPicker = ({
  onPick,
}: {
  onPick: (kind: ReactionKind) => void;
}) => {
  const { t } = useTranslation();
  return (
    <>
      {REACTION_KINDS.map((kind) => {
        const Icon = REACTION_ICONS[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(kind);
            }}
            aria-label={t(`chat.reaction.${kind}`)}
            className="rounded-lg p-1.5 hover:bg-muted"
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </>
  );
};

export default MessageReactions;
