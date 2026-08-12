import { useTranslation } from "react-i18next";
import { Ban } from "lucide-react";

/**
 * 取り消されたメッセージの吹き出し。
 *
 * ⚠️ **行ごと消さない。** 会話から吹き出しが丸ごと消えると、
 *    「何か言ったはずなのに無い」という別の混乱を生む。
 *    LINE と同じく「送信を取り消しました」を残す。
 */
const UnsentNotice = () => {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1.5 text-xs italic opacity-70">
      <Ban className="w-3.5 h-3.5 shrink-0" />
      {t("chat.unsentNotice")}
    </span>
  );
};

export default UnsentNotice;
