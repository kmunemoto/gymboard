import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { BLOCK_PURPOSE_MAX } from "@/lib/blockPurpose";

/**
 * ブロック枠の用事名の入力欄。
 *
 * 🔴 **ダイアログのいちばん上に置く。** 日付・開始・終了は「前が埋まるまで次が出ない」
 * 作りだが、用事名はその流れに乗せない:
 *
 *  - 任意の欄なので、下に隠れていると気づかれない
 *  - ダイアログは画面中央から上に出るので、**上半分ならキーボードで隠れない**
 *  - 「何のブロック？」→「いつ？」は順序としても自然
 *
 * 🔴 **`TrainerSchedule.tsx` に直接書かない。** あちらは 1291行で、上限が 1300
 * （`src/test/qualityRatchet.test.ts`）。9行しか余裕がないので外に出している。
 */
const BlockPurposeField = ({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-4">
      <label htmlFor="block-purpose" className="text-xs font-semibold text-muted-foreground mb-1 block">
        {t("schedule.blockPurposeLabel")}
      </label>
      <Input
        id="block-purpose"
        className="h-10"
        value={value}
        maxLength={BLOCK_PURPOSE_MAX}
        placeholder={t("schedule.blockPurposePlaceholder")}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* 🔴 「画面には出ません」とは書かない。RLS でお客様から読めなくしたうえでの
          「見えません」なので、そのまま言い切ってよい（blockPurpose.ts の注記）。 */}
      <p className="text-[10px] text-muted-foreground mt-1">{t("schedule.blockPurposeNote")}</p>
    </div>
  );
};

export default BlockPurposeField;
