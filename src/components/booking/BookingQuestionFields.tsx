import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ANSWER_MAX_LENGTH,
  resolveInputType,
  type BookingQuestion,
} from "@/lib/bookingQuestions";

/**
 * 予約時のカスタム質問（事前アンケート）の入力欄。
 *
 * 会員の予約・体験予約・ドロップイン・店側の代理予約の**4画面で同じものを出す**ため、
 * ここ1箇所に置く。画面ごとに書くと、入力欄の種類を足したときに必ず取りこぼす。
 *
 * 文言（見出しや必須マーク）は呼び出し側が i18n から渡す。ここは
 * **店が入力した質問文をそのまま出すだけ**なので、このファイル自体は語彙を持たない
 * （業種フォークでも読み替え不要）。
 */
interface Props {
  questions: ReadonlyArray<BookingQuestion>;
  values: Record<string, string>;
  onChange: (questionId: string, value: string) => void;
  /** 必須なのに空だった質問の id。赤字で示す。 */
  missingIds?: ReadonlyArray<string>;
  /** 「必須」の表示文言。 */
  requiredLabel: string;
  /** チェックボックスに入れる値（保存される文字列）。 */
  checkedValue: string;
  disabled?: boolean;
}

const BookingQuestionFields = ({
  questions,
  values,
  onChange,
  missingIds = [],
  requiredLabel,
  checkedValue,
  disabled,
}: Props) => {
  if (questions.length === 0) return null;
  const missing = new Set(missingIds);

  return (
    <div className="space-y-4">
      {questions.map((q) => {
        const type = resolveInputType(q.input_type);
        const value = values[q.id] ?? "";
        const isMissing = missing.has(q.id);
        const fieldId = `bq-${q.id}`;
        return (
          <div key={q.id} className="space-y-1.5">
            <Label htmlFor={fieldId} className="text-sm font-medium">
              {q.label}
              {q.required && (
                <span className="ml-1.5 text-[10px] font-bold text-destructive align-middle">
                  {requiredLabel}
                </span>
              )}
            </Label>
            {q.help_text && (
              <p className="text-xs text-muted-foreground leading-relaxed">{q.help_text}</p>
            )}

            {type === "textarea" && (
              <Textarea
                id={fieldId}
                value={value}
                maxLength={ANSWER_MAX_LENGTH}
                rows={3}
                disabled={disabled}
                aria-invalid={isMissing || undefined}
                onChange={(e) => onChange(q.id, e.target.value)}
              />
            )}

            {type === "text" && (
              <Input
                id={fieldId}
                value={value}
                maxLength={ANSWER_MAX_LENGTH}
                disabled={disabled}
                aria-invalid={isMissing || undefined}
                onChange={(e) => onChange(q.id, e.target.value)}
              />
            )}

            {type === "select" && (
              // shadcn の Select ではなく素の <select> を使う。選択肢が店の自由入力で
              // 増減するため、キーボード操作・iOS のホイールUIがそのまま効くほうが確実。
              <select
                id={fieldId}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                value={value}
                disabled={disabled}
                aria-invalid={isMissing || undefined}
                onChange={(e) => onChange(q.id, e.target.value)}
              >
                <option value="" />
                {(q.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {type === "checkbox" && (
              <div className="flex items-center gap-2 pt-0.5">
                <Checkbox
                  id={fieldId}
                  checked={value !== ""}
                  disabled={disabled}
                  onCheckedChange={(checked) => onChange(q.id, checked === true ? checkedValue : "")}
                />
                <Label htmlFor={fieldId} className="text-sm font-normal text-muted-foreground">
                  {checkedValue}
                </Label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BookingQuestionFields;
