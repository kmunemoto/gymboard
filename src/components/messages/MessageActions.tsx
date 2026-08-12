import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Reply, Undo2 } from "lucide-react";

interface MessageActionsProps {
  /** 吹き出しの中身 */
  children: React.ReactNode;
  onReply: () => void;
  /** 送信取り消し。できない相手／時間切れなら渡さない */
  onUnsend?: () => void;
  /** 右寄せの吹き出しか（メニューの出る向きを合わせる） */
  alignEnd?: boolean;
}

/** 長押しと判定するまでの時間。短いとスクロールで誤爆する。 */
const LONG_PRESS_MS = 450;

/**
 * 吹き出しの長押し（PC は右クリック）で出る操作メニュー。
 *
 * ## なぜ長押しなのか
 *
 * 吹き出しに常時ボタンを置くと、会話が**ボタンだらけ**になって読みにくい。
 * LINE と同じく、必要なときだけ出す。
 *
 * ⚠️ **スクロールで誤爆させない。** 指が動いたら長押しを取り消す。
 *    ここを雑にすると、会話を遡るたびにメニューが出て使い物にならない。
 */
const MessageActions = ({ children, onReply, onUnsend, alignEnd = false }: MessageActionsProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startY = useRef(0);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => cancel, []);

  // 開いている間は、外側のどこを触っても閉じる
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // 同じタップで即閉じないよう次のフレームから拾う
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", close);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <div className="relative">
      <div
        onPointerDown={(e) => {
          startY.current = e.clientY;
          cancel();
          timer.current = setTimeout(() => setOpen(true), LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          // 指が縦に動いた＝スクロール。長押しにしない
          if (Math.abs(e.clientY - startY.current) > 8) cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          // PC の右クリック。既定のメニューは邪魔なので止める
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </div>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-20 mt-1 flex gap-1 rounded-xl border border-border bg-popover p-1 shadow-lg ${
            alignEnd ? "right-0" : "left-0"
          }`}
        >
          <button
            type="button"
            onClick={pick(onReply)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Reply className="w-3.5 h-3.5" />
            {t("chat.reply")}
          </button>
          {onUnsend && (
            <button
              type="button"
              onClick={pick(onUnsend)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-destructive hover:bg-muted"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {t("chat.unsend")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageActions;
