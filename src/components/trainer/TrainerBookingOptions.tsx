import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw, Save, Sparkles, Trash2, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  OPTION_DURATION_OPTIONS,
  OPTION_NAME_MAX,
  validateBookingOption,
  OPTION_DESCRIPTION_MAX,
} from "@/lib/bookingOptions";
import { allowedCustomersDiff } from "@/lib/bookingOptionAccess";
import BookingOptionCustomersDialog from "./BookingOptionCustomersDialog";

/**
 * 予約のオプション（`booking_options`）を編集する。
 *
 * 例:「トレーニングのあとに 30分 3,000円 のストレッチ」。追加した時間は
 * **同じ1回のセッション**として扱う（間の準備時間は挟まない）。詳しくは
 * `src/lib/bookingOptions.ts` と `supabase/migrations/20260902000000_booking_options.sql`。
 *
 * 🔴 保存は「更新 → 追加 → 削除」の順。削除を先にすると、追加だけ失敗したときに
 *    オプションが静かに全部消える（TrainerCapacityWindows と同じ理由）。
 *
 * 🔴 追加した行の id は insert の `.select("id")` で必ず受け取る。受け取らないと
 *    最後の削除の「残す id」に入らず、**いま入れた行を自分で消す**。
 *    条件なしの全削除は「画面が0件のとき」だけ。残す id の件数で判断してはいけない
 *    （2026-09-03: 最初の1件を追加すると保存直後に消える不具合を出荷した）。
 *    順番だけを見る検査では捕まらないので、src/test/trainerBookingOptionsSave.test.tsx
 *    で偽の DB を相手に実際に保存させて見張っている。
 *
 * 🔴 行の id は保存しても変わらない（差し替えではなく更新する）。
 *    予約側がオプションを id で指すようになるため、保存のたびに id が変わると
 *    過去の予約から「何を付けたか」が辿れなくなる。
 *
 * ## 指定したお客様だけに出す（2026-10-26・src/lib/bookingOptionAccess.ts）
 *
 * `restricted` と「選べるお客様」（`booking_option_customers`）。読み込みはオプションと
 * 一緒に1回で取る（埋め込み）。保存は、オプションの保存が全部終わってから**差分だけ**書く
 * （新しく足したオプションは、採番された id が分かってから）。
 */

interface EditableOption {
  key: string;
  /** DB にある行なら id、追加したばかりなら null */
  id: string | null;
  name: string;
  duration: number;
  /** 入力途中を保つため文字列で持つ（"" は「料金を表示しない」= 0） */
  price: string;
  /**
   * お客様が**予約の確認カードで読む**説明文。空なら今までどおり名前だけを出す。
   * 🔴 店内メモではない。書いた内容はそのままお客様に見える。
   */
  description: string;
  enabled: boolean;
  /** 指定したお客様だけに出す */
  restricted: boolean;
  /** 選べるお客様（user_id）。画面で直した後の値 */
  allowedUserIds: string[];
  /** 読み込んだときの値。保存で差分だけ書くために持つ */
  loadedAllowedUserIds: string[];
}

/** オプションと「選べるお客様」を1回で読む（埋め込み）。型の推論を通さないため string で持つ */
const OPTION_COLUMNS: string =
  "id, name, duration_minutes, price_yen, description, enabled, sort_order, restricted, booking_option_customers(user_id)";

const newKey = () => `o-${Math.random().toString(36).slice(2, 10)}`;

/** 追加ボタンの既定値。いちばん多い形（トレーニング後の30分）をそのまま出す。 */
const defaultOption = (): EditableOption => ({
  key: newKey(),
  id: null,
  name: "",
  duration: 30,
  price: "",
  description: "",
  enabled: true,
  restricted: false,
  allowedUserIds: [],
  loadedAllowedUserIds: [],
});

const toPriceYen = (price: string): number => {
  const n = parseInt(price.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const TrainerBookingOptions = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [options, setOptions] = useState<EditableOption[]>([]);
  const [loading, setLoading] = useState(true);
  // 読み込み失敗を「0件」と区別する。区別しないと、通信が一瞬切れたあとに
  // 保存を押しただけで既存のオプションを全削除できてしまう。
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // 「お客様を選ぶ」を開いているオプションの key（開いていなければ null）
  const [pickerKey, setPickerKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setLoadFailed(false);
    const { data, error } = await supabase
      .from("booking_options")
      .select(OPTION_COLUMNS)
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) {
      setOptions([]);
      setLoadFailed(true);
    } else {
      setOptions(
        (data as unknown as Record<string, unknown>[]).map((o) => {
          const allowed = Array.isArray(o.booking_option_customers)
            ? (o.booking_option_customers as { user_id: string }[]).map((c) => c.user_id)
            : [];
          return {
            key: String(o.id),
            id: String(o.id),
            name: String(o.name ?? ""),
            duration: Number(o.duration_minutes ?? 0),
            price: Number(o.price_yen ?? 0) > 0 ? String(o.price_yen) : "",
            description: (o.description as string | null) ?? "",
            enabled: o.enabled !== false,
            restricted: o.restricted === true,
            allowedUserIds: allowed,
            loadedAllowedUserIds: allowed,
          };
        }),
      );
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  const patch = (key: string, next: Partial<EditableOption>) =>
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...next } : o)));

  const handleSave = async () => {
    if (!tenant?.id) return;

    for (const o of options) {
      const reason = validateBookingOption({
        name: o.name,
        duration_minutes: o.duration,
        price_yen: toPriceYen(o.price),
        description: o.description,
      });
      if (reason) {
        toast.error(t(`bookingOptions.invalid.${reason}`));
        return;
      }
    }

    setSaving(true);
    const rows = options.map((o, i) => ({
      id: o.id,
      tenant_id: tenant.id,
      name: o.name.trim(),
      duration_minutes: o.duration,
      price_yen: toPriceYen(o.price),
      // 空欄は NULL にする（"" のまま入れると「説明がある」扱いで空行が出る）
      description: o.description.trim() || null,
      enabled: o.enabled,
      restricted: o.restricted,
      sort_order: i,
    }));

    // 1) 既にある行を更新する（id を変えない）
    for (const row of rows.filter((r) => r.id)) {
      const { id, ...values } = row;
      const { error } = await supabase
        .from("booking_options")
        .update(values as never)
        .eq("id", id as string);
      if (error) {
        console.error("予約オプションの更新に失敗:", error);
        toast.error(t("bookingOptions.saveFailed"));
        setSaving(false);
        return;
      }
    }

    // 2) 追加ぶんを入れる
    //    🔴 `.select("id")` で採番された id を必ず受け取る。受け取らないと 3) の
    //       keepIds に入らず、いま入れたばかりの行を自分で消してしまう。
    const added = rows.filter((r) => !r.id).map(({ id: _id, ...values }) => values);
    const addedIds: string[] = [];
    if (added.length > 0) {
      const { data: inserted, error } = await supabase
        .from("booking_options")
        .insert(added as never)
        .select("id");
      if (error) {
        console.error("予約オプションの追加に失敗:", error);
        toast.error(t("bookingOptions.saveFailed"));
        setSaving(false);
        void load();
        return;
      }
      addedIds.push(...((inserted ?? []) as { id: string }[]).map((r) => r.id));
    }

    // 3) 画面から消したぶんを消す（最後にやる）
    const keepIds = [
      ...rows.map((r) => r.id).filter((v): v is string => Boolean(v)),
      ...addedIds,
    ];
    // 🔴 条件なしの全削除は「画面が0件のとき」だけ。keepIds の件数で分岐すると、
    //    初めてオプションを1つ追加した保存（既存0件・keepIds が空に見える）で
    //    いま入れた行ごと消える。2026-09-03 に実際にそうなった。
    let delErr: { message?: string } | null = null;
    if (rows.length === 0) {
      ({ error: delErr } = await supabase
        .from("booking_options")
        .delete()
        .eq("tenant_id", tenant.id));
    } else if (keepIds.length > 0) {
      ({ error: delErr } = await supabase
        .from("booking_options")
        .delete()
        .eq("tenant_id", tenant.id)
        .not("id", "in", `(${keepIds.join(",")})`));
    } else {
      // 行はあるのに残すべき id が1つも分からない（insert が id を返さない等）。
      // 消す根拠が無いので何もしない。消し損ねは load() で画面に出るが、
      // ここで全削除すると取り返せない。
      console.error("予約オプション: 残す id が取れなかったので削除を見送った");
    }
    if (delErr) {
      console.error("予約オプションの削除に失敗:", delErr);
      toast.error(t("bookingOptions.saveFailed"));
      setSaving(false);
      void load();
      return;
    }

    // 4) 選べるお客様（差分だけ書く）。新しく足したオプションは 2) で採番された id を使う
    //    （insert は渡した順に返る）。オプションを消した場合は外部キーで一緒に消える。
    const addedKeys = options.filter((o) => !o.id).map((o) => o.key);
    for (const o of options) {
      const optionId = o.id ?? addedIds[addedKeys.indexOf(o.key)] ?? null;
      if (!optionId) continue;
      const { add, remove } = allowedCustomersDiff(o.loadedAllowedUserIds, o.allowedUserIds);
      let listErr: { message?: string } | null = null;
      if (remove.length > 0) {
        ({ error: listErr } = await supabase
          .from("booking_option_customers")
          .delete()
          .eq("option_id", optionId)
          .in("user_id", remove));
      }
      if (!listErr && add.length > 0) {
        ({ error: listErr } = await supabase
          .from("booking_option_customers")
          .insert(add.map((user_id) => ({ option_id: optionId, user_id, tenant_id: tenant.id }))));
      }
      if (listErr) {
        console.error("選べるお客様の保存に失敗:", listErr);
        toast.error(t("bookingOptions.saveFailed"));
        setSaving(false);
        void load();
        return;
      }
    }

    toast.success(options.length === 0 ? t("bookingOptions.cleared") : t("bookingOptions.saved"));
    setSaving(false);
    void load();
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        {t("bookingOptions.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("bookingOptions.desc")}</p>

          {loadFailed && !loading && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-destructive">{t("bookingOptions.loadFailed")}</p>
              <Button variant="outline" size="sm" className="h-8" onClick={() => void load()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                {t("bookingOptions.reload")}
              </Button>
            </div>
          )}
          {options.length === 0 && !loading && !loadFailed && (
            <p className="text-xs text-muted-foreground">{t("bookingOptions.empty")}</p>
          )}

          {options.map((o) => (
            <div key={o.key} className="rounded-lg border border-border p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={o.enabled}
                    aria-label={t("bookingOptions.enabledLabel")}
                    onCheckedChange={(on) => patch(o.key, { enabled: on })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {o.enabled ? t("bookingOptions.enabledLabel") : t("bookingOptions.disabledLabel")}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-destructive"
                  aria-label={t("common.delete")}
                  onClick={() => setOptions((prev) => prev.filter((x) => x.key !== o.key))}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("bookingOptions.nameLabel")}</Label>
                <Input
                  className="h-10"
                  maxLength={OPTION_NAME_MAX}
                  value={o.name}
                  placeholder={t("bookingOptions.namePlaceholder")}
                  onChange={(e) => patch(o.key, { name: e.target.value })}
                />
              </div>

              <div className="flex gap-2">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs font-bold">{t("bookingOptions.durationLabel")}</Label>
                  <Select
                    value={String(o.duration)}
                    onValueChange={(v) => patch(o.key, { duration: Number(v) })}
                  >
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {/* SQL直挿入等で一覧に無い値が入っていても表示を保つ（黙って丸めない） */}
                      {!OPTION_DURATION_OPTIONS.includes(o.duration) && (
                        <SelectItem value={String(o.duration)}>
                          {t("bookingOptions.durationUnit", { count: o.duration })}
                        </SelectItem>
                      )}
                      {OPTION_DURATION_OPTIONS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {m === 0
                            ? t("bookingOptions.durationNone")
                            : t("bookingOptions.durationUnit", { count: m })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs font-bold">{t("bookingOptions.priceLabel")}</Label>
                  <Input
                    className="h-10"
                    inputMode="numeric"
                    value={o.price}
                    placeholder={t("bookingOptions.pricePlaceholder")}
                    onChange={(e) => patch(o.key, { price: e.target.value.replace(/[^\d]/g, "") })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("bookingOptions.priceHint")}</p>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("bookingOptions.descriptionLabel")}</Label>
                <Textarea
                  rows={4}
                  maxLength={OPTION_DESCRIPTION_MAX}
                  value={o.description}
                  placeholder={t("bookingOptions.descriptionPlaceholder")}
                  onChange={(e) => patch(o.key, { description: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("bookingOptions.descriptionHelp")}
                  <span className="ml-1 tabular-nums">{o.description.length}/{OPTION_DESCRIPTION_MAX}</span>
                </p>
              </div>
              <div className="space-y-1.5 rounded-lg bg-muted/40 p-2.5" data-testid="option-restricted">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-bold flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5" />
                    {t("bookingOptions.restrictedLabel")}
                  </Label>
                  <Switch
                    checked={o.restricted}
                    aria-label={t("bookingOptions.restrictedLabel")}
                    onCheckedChange={(on) => patch(o.key, { restricted: on })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t("bookingOptions.restrictedHelp")}</p>
                {o.restricted && (
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${o.allowedUserIds.length === 0 ? "text-destructive" : ""}`}>
                      {o.allowedUserIds.length === 0
                        ? t("bookingOptions.restrictedNone")
                        : t("bookingOptions.restrictedCount", { count: o.allowedUserIds.length })}
                    </span>
                    <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setPickerKey(o.key)}>
                      {t("bookingOptions.chooseCustomers")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => setOptions((prev) => [...prev, defaultOption()])}
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("bookingOptions.addOption")}
            </Button>
            <Button onClick={handleSave} disabled={saving || loading || loadFailed} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("bookingOptions.footprintNote")}</p>
        </CardContent>
      </Card>
      {(() => {
        const target = options.find((o) => o.key === pickerKey);
        return target ? (
          <BookingOptionCustomersDialog
            optionName={target.name}
            selected={target.allowedUserIds}
            onDone={(ids) => { patch(target.key, { allowedUserIds: ids }); setPickerKey(null); }}
            onClose={() => setPickerKey(null)}
          />
        ) : null;
      })()}
    </div>
  );
};

export default TrainerBookingOptions;
