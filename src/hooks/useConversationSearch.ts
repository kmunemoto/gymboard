import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { searchMessages, stepHit, type SearchableMessage } from "@/lib/messageSearch";

/**
 * 会話の中を探す状態。
 *
 * 読み込み済みのメッセージをその場で絞るだけなので、サーバーには問い合わせない。
 */
export const useConversationSearch = (messages: SearchableMessage[]) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  /** ヒットした吹き出しの DOM。ジャンプに使う */
  const refs = useRef(new Map<string, HTMLElement | null>());

  const hits = useMemo(() => searchMessages(messages, query), [messages, query]);

  // 語を変えたら先頭のヒットから。
  // ⚠️ index を残すと、件数が減ったときに**範囲外を指したまま**になる。
  useEffect(() => {
    setIndex(0);
  }, [query]);

  const currentId = hits.length > 0 ? hits[Math.min(index, hits.length - 1)] : null;

  // ヒット位置へジャンプ。ここが無いと「3/12件」と出るだけで探せない。
  useEffect(() => {
    if (!currentId) return;
    refs.current.get(currentId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentId]);

  const step = useCallback(
    (dir: "next" | "prev") => setIndex((i) => stepHit(i, hits.length, dir)),
    [hits.length],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const registerRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) refs.current.set(id, el);
      else refs.current.delete(id);
    },
    [],
  );

  return {
    open,
    setOpen,
    query,
    setQuery,
    /** ヒットした id（会話の並び順） */
    hits,
    /** いまジャンプしている id */
    currentId,
    index,
    step,
    close,
    registerRef,
    /** 検索中か。強調の有無に使う */
    active: open && query.trim().length > 0,
  };
};
