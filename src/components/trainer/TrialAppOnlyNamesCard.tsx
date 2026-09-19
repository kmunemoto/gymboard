import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/**
 * 体験予約ページ（/trial）で「アプリからご予約ください」と案内するお名前の登録。
 * （`tenants.trial_app_only_names`。既定は空＝誰も案内しない）
 *
 * 実店舗の要望（2026-09-19 宗本さん）:
 *
 * > すでに会員でアプリのアカウントもある方が、体験予約サイトから予約してしまう。
 * > 直接は言いにくいので、体験予約サイトからは予約できないようにして、
 * > アプリから予約するよう案内を出したい。
 *
 * ## 🔴 ここが唯一の置き場
 *
 * お名前は**個人情報**なので、リポジトリにも公開ページの JS にも置かない
 * （このリポジトリは public）。登録された単語は
 *   - `get_tenant_public` では返さない（公開ページに配らない）
 *   - 判定用の RPC は「当たったか」だけを boolean で返す
 * という形で、店の人だけが見られるようにしてある。
 *
 * ## 判定のしかた
 *
 * 全角/半角・ひらがな/カタカナ・空白・中黒の違いを吸収したうえでの**部分一致**。
 * 姓だけを登録すれば姓名で書かれても当たる。逆に**短い単語ほど広く当たる**ので、
 * 「よくある姓」1文字だけの登録は、関係のない新規のお客様まで案内してしまう。
 *
 * ## 効く範囲
 *
 * 体験予約（`/trial`）だけ。ドロップイン・会員の予約・店の代理予約には効かない。
 */

/** 1単語の長さの上限。長すぎる入力を保存させない */
const MAX_WORD_LENGTH = 40;
/** 登録できる単語の数の上限 */
const MAX_WORDS = 30;

const TrialAppOnlyNamesCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const stored = tenant?.trial_app_only_names;
  // 列がまだ無い環境では undefined。空配列に倒して「登録なし＝誰も案内しない」に揃える。
  const words: string[] = Array.isArray(stored) ? stored : [];

  const save = async (next: string[]) => {
    if (!tenant) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ trial_app_only_names: next })
      .eq("id", tenant.id);
    setSaving(false);
    if (error) {
      // 失敗理由（例: 列がまだ無い＝マイグレーション未適用）を画面でも確認できるようにする
      console.error("アプリ案内のお名前の保存に失敗:", error);
      toast.error(t("settings.trainer.trialAppOnlySaveFailed"), { description: error.message });
      return;
    }
    toast.success(t("settings.trainer.trialAppOnlySaved"));
    refetchTenant();
  };

  const handleAdd = async () => {
    const word = draft.trim();
    // 空白だけの単語を入れさせない。入ると**全員が案内対象**になる
    // （正規化後に空文字となり、部分一致が必ず成立するため。DB 側でも弾いている）。
    if (!word) return;
    if (word.length > MAX_WORD_LENGTH) {
      toast.error(t("settings.trainer.trialAppOnlyTooLong", { max: MAX_WORD_LENGTH }));
      return;
    }
    if (words.includes(word)) {
      setDraft("");
      return;
    }
    if (words.length >= MAX_WORDS) {
      toast.error(t("settings.trainer.trialAppOnlyTooMany", { max: MAX_WORDS }));
      return;
    }
    setDraft("");
    await save([...words, word]);
  };

  const handleRemove = async (word: string) => {
    await save(words.filter((w) => w !== word));
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="trial-app-only-name" className="text-sm font-bold">
            {t("settings.trainer.trialAppOnlyLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.trainer.trialAppOnlyDesc")}
          </p>
        </div>

        {words.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {words.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"
              >
                {word}
                <button
                  type="button"
                  onClick={() => void handleRemove(word)}
                  disabled={saving}
                  aria-label={t("settings.trainer.trialAppOnlyRemove", { word })}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            id="trial-app-only-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 日本語入力の変換確定の Enter で追加してしまわないようにする
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleAdd();
              }
            }}
            maxLength={MAX_WORD_LENGTH}
            placeholder={t("settings.trainer.trialAppOnlyPlaceholder")}
            disabled={saving}
          />
          <Button type="button" onClick={() => void handleAdd()} disabled={saving || !draft.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            {t("settings.trainer.trialAppOnlyAdd")}
          </Button>
        </div>

        {words.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {t("settings.trainer.trialAppOnlyWarning")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TrialAppOnlyNamesCard;
