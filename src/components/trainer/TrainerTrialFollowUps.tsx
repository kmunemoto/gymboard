import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCheck, Phone, StickyNote, Save, TrendingUp, AlertCircle, JapaneseYen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { formatJST } from "@/lib/timezone";
import { ja } from "date-fns/locale";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { hasTrialPrice } from "@/lib/trialPricing";

// 体験予約のフォローアップ管理（体験CRM）。trial_bookings.follow_up_status/note は
// マイグレーション未適用の環境では存在しないため、select("*") + any キャストで
// 扱う（useTenant 等、既存の新カラム未適用フォールバック方針と同じ）。
/**
 * フォロー状況。**DB にはこのコードが入る**（2026-08-26 に日本語からコード化）。
 *
 * ⚠️ 公開済みのネイティブアプリは日本語（未対応 等）を書いてくる。
 *    DB 側の BEFORE トリガー（normalize_trial_follow_up_status）が入口で
 *    コードに直すので、古いアプリも今までどおり動く。
 *    ここで日本語を復活させないこと（DB の CHECK に弾かれる）。
 */
/**
 * 1回に読む件数。
 *
 * 体験予約は消さずに積み上がる（本番は約2か月で70件）。全件読むと、
 * 続けるほど開くのが遅くなる。フォローは鮮度が命なので直近だけ見れば足りる。
 */
export const TRIAL_PAGE = 100;

export const FOLLOW_UP_STATUSES = ["pending", "visited", "joined", "declined"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/**
 * 体験料の徴収結果（trial_bookings.trial_fee_status）。
 *
 * ⚠️ **アプリは決済しない。** 現金・カード・QR はこれまでどおり店頭の手段で受け取る。
 *    ここに持つのは「その結果どうなったか」の記録だけ。
 *
 * 料金を設定していないジム（tenants.trial_price_yen が null）には、この欄自体を出さない。
 */
export const TRIAL_FEE_STATUSES = ["未確認", "頂いた", "入会のため免除"] as const;
export type TrialFeeStatus = (typeof TRIAL_FEE_STATUSES)[number];

const FEE_I18N_KEY: Record<TrialFeeStatus, string> = {
  "未確認": "pending",
  "頂いた": "collected",
  "入会のため免除": "waived",
};

/** DB は自由文字列にもなりうるので、未知の値は「未確認」に寄せる（follow_up_status と同じ扱い） */
const feeI18nKey = (v: string | null | undefined): string =>
  FEE_I18N_KEY[(v ?? "未確認") as TrialFeeStatus] ?? FEE_I18N_KEY["未確認"];

/**
 * DB の値 → 翻訳キー。コード化したので基本は同じ文字列だが、
 * **古い日本語の値もここで受ける**（トリガー適用前に入った行や、
 * トリガーの無い環境のため）。未知の値は pending に倒す
 * （解決できないと画面に "trialFollowUp.status.undefined" が出る）。
 */
const LEGACY_STATUS: Record<string, FollowUpStatus> = {
  "未対応": "pending",
  "来店した": "visited",
  "入会した": "joined",
  "見送り": "declined",
};

export const normalizeStatus = (status: string | null | undefined): FollowUpStatus => {
  const v = status ?? "pending";
  if ((FOLLOW_UP_STATUSES as readonly string[]).includes(v)) return v as FollowUpStatus;
  return LEGACY_STATUS[v] ?? "pending";
};

const statusI18nKey = (status: string | null | undefined): string => normalizeStatus(status);

interface TrialRow {
  id: string;
  guest_name: string;
  guest_contact: string;
  booking_date: string;
  booking_type: string;
  status: string;
  follow_up_status: FollowUpStatus | null;
  follow_up_note: string | null;
  /** 体験料の徴収結果。null は未記録（列が無い環境でも null になる） */
  trial_fee_status: TrialFeeStatus | null;
  /** 店がフォローした時刻。null なら未対応のまま */
  followed_up_at: string | null;
  /** 流入元（どこで知ったか） */
  source: string | null;
  /** 見送りの理由。declined のときだけ意味を持つ */
  declined_reason: string | null;
}

const statusBadgeVariant = (status: FollowUpStatus): "outline" | "secondary" | "default" | "destructive" => {
  switch (status) {
    case "joined": return "default";
    case "visited": return "secondary";
    case "declined": return "destructive";
    default: return "outline";
  }
};

/**
 * その場で書ける1行の入力欄（流入元・見送り理由）。
 *
 * 入力するのは体験のあと、店が思い出しながら書くもの。ダイアログを開かせると
 * 書かなくなるので、カードの中で完結させる（メモ欄と同じ考え方）。
 * 変えていないときは保存ボタンを出さない＝押す判断をさせない。
 */
const InlineField = ({
  label, placeholder, value, maxLength, disabled, onSave,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  maxLength: number;
  disabled: boolean;
  onSave: (v: string) => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? "");
  // 外から値が変わったら追随する（保存後・再取得後）
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const dirty = draft.trim() !== (value ?? "");

  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className="h-9 text-xs"
        />
        {dirty && (
          <Button
            size="sm"
            className="h-9 text-xs shrink-0"
            disabled={disabled}
            onClick={() => onSave(draft)}
          >
            {t("common.save")}
          </Button>
        )}
      </div>
    </div>
  );
};

const TrainerTrialFollowUps = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("trial_bookings")
        // ⚠️ select("*") をやめる。体験は積み上がる一方なので、
        //    画面が使わない列（cancel_token・google_event_id・custom_answers）まで
        //    毎回運ぶと、件数が増えたぶんだけ重くなる
        .select(
          "id, guest_name, guest_contact, booking_date, booking_type, status, " +
          "follow_up_status, follow_up_note, trial_fee_status, followed_up_at, source, declined_reason",
        )
        .eq("tenant_id", tenant.id)
        .neq("status", "キャンセル済み")
        .order("booking_date", { ascending: false })
        // 直近だけ見れば足りる（フォローは鮮度が命で、半年前の体験は追わない）。
        // 全部見たいときのために、上限に達したら画面で知らせる
        .limit(TRIAL_PAGE);
      if (cancelled) return;
      if (error) {
        console.warn("体験フォロー一覧の取得に失敗（マイグレーション未適用の可能性）:", error.message);
        setRows([]);
      } else {
        setRows(
          (data || []).map((r: any) => ({
            id: r.id,
            guest_name: r.guest_name,
            guest_contact: r.guest_contact,
            booking_date: r.booking_date,
            booking_type: r.booking_type,
            status: r.status,
            follow_up_status: normalizeStatus(r.follow_up_status),
            follow_up_note: r.follow_up_note ?? null,
            // 列が無い環境（マイグレーション未適用）では undefined → null。
            trial_fee_status: (r.trial_fee_status as TrialFeeStatus) ?? null,
            followed_up_at: r.followed_up_at ?? null,
            source: r.source ?? null,
            declined_reason: r.declined_reason ?? null,
          })),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  const now = useMemo(() => new Date(), []);
  const needsFollowUp = useMemo(
    () => rows.filter((r) => r.follow_up_status === "pending" && new Date(r.booking_date) < now)
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date)),
    [rows, now],
  );

  const conversion = useMemo(() => {
    const decided = rows.filter((r) => r.follow_up_status === "joined" || r.follow_up_status === "declined");
    const joined = rows.filter((r) => r.follow_up_status === "joined");
    if (decided.length === 0) return null;
    return Math.round((joined.length / decided.length) * 100);
  }, [rows]);

  const handleStatusChange = async (id: string, status: FollowUpStatus) => {
    setSavingId(id);
    // フォローした時刻を一緒に記録する。「いつ動いたか」が分からないと、
    // 何日も放置されている人を見つけられない（状態だけでは古さが見えない）。
    // 未対応に戻したときは時刻も消す（対応していないので）
    const followedUpAt = status === "pending" ? null : new Date().toISOString();
    const { error } = await supabase
      .from("trial_bookings")
      .update({ follow_up_status: status, followed_up_at: followedUpAt } as any)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      console.error("フォロー状況の更新に失敗:", error);
      toast.error(t("trialFollowUp.updateFailed"), { description: error.message });
      return;
    }
    setRows((prev) => prev.map((r) =>
      (r.id === id ? { ...r, follow_up_status: status, followed_up_at: followedUpAt } : r)));
    toast.success(t("trialFollowUp.updated"));
  };

  /** 流入元・見送り理由。どちらも自由入力なので、保存の形は同じ。 */
  const handleSaveText = async (
    id: string,
    field: "source" | "declined_reason",
    value: string,
  ) => {
    setSavingId(id);
    const v = value.trim() || null;
    const { error } = await supabase
      .from("trial_bookings")
      .update({ [field]: v } as any)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      console.error("体験CRMの保存に失敗:", error);
      toast.error(t("trialFollowUp.updateFailed"), { description: error.message });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
    toast.success(t("trialFollowUp.updated"));
  };

  const handleFeeChange = async (id: string, fee: TrialFeeStatus) => {
    setSavingId(id);
    const { error } = await supabase
      .from("trial_bookings")
      .update({ trial_fee_status: fee } as any)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      // 列未追加（マイグレーション未適用）もここに来る。理由を画面でも見せる。
      console.error("体験料の記録に失敗:", error);
      toast.error(t("trialFollowUp.feeUpdateFailed"), { description: error.message });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, trial_fee_status: fee } : r)));
    toast.success(t("trialFollowUp.feeUpdated"));
  };

  const handleSaveNote = async (id: string) => {
    setSavingId(id);
    const note = noteDraft.trim();
    const { error } = await supabase
      .from("trial_bookings")
      .update({ follow_up_note: note || null } as any)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      console.error("フォローメモの保存に失敗:", error);
      toast.error(t("trialFollowUp.noteSaveFailed"), { description: error.message });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, follow_up_note: note || null } : r)));
    setEditingNoteId(null);
    toast.success(t("trialFollowUp.noteSaved"));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  // 体験料の欄を出すか。**料金を設定しているジムだけ。**
  // hasTrialPrice を通すのは 0（¥0 と明示）と未設定を区別するため。
  const showFee = hasTrialPrice(tenant?.trial_price_yen);

  const renderCard = (r: TrialRow) => (
    <Card key={r.id} className={r.follow_up_status === "pending" && new Date(r.booking_date) < now ? "border-warning/40" : undefined}>
      <CardContent className="p-3 sm:p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">{r.guest_name}</p>
            <p className="text-xs text-muted-foreground">
              {formatJST(r.booking_date, "M月d日（E）HH:mm", { locale: ja })}
            </p>
            {r.guest_contact && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3 shrink-0" />
                <span className="truncate">{r.guest_contact}</span>
              </p>
            )}
          </div>
          <Badge variant={statusBadgeVariant(r.follow_up_status ?? "pending")} className="shrink-0 text-[10px]">
            {t(`trialFollowUp.status.${statusI18nKey(r.follow_up_status)}`)}
          </Badge>
        </div>

        <Select
          value={r.follow_up_status ?? "pending"}
          disabled={savingId === r.id}
          onValueChange={(v) => handleStatusChange(r.id, v as FollowUpStatus)}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FOLLOW_UP_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{t(`trialFollowUp.status.${statusI18nKey(s)}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* いつフォローしたか。状態だけでは「何日放置されているか」が見えない */}
        {r.followed_up_at && (
          <p className="text-[11px] text-muted-foreground">
            {t("trialFollowUp.followedUpAt", { date: formatJST(r.followed_up_at, "M/d HH:mm") })}
          </p>
        )}

        {/* 流入元。どこで知ったか。次にどこへ出すかの材料になる */}
        <InlineField
          label={t("trialFollowUp.sourceLabel")}
          placeholder={t("trialFollowUp.sourcePlaceholder")}
          value={r.source}
          maxLength={100}
          disabled={savingId === r.id}
          onSave={(v) => handleSaveText(r.id, "source", v)}
        />

        {/* 見送りの理由は「見送り」のときだけ。常に出すと入力欄だらけになる */}
        {r.follow_up_status === "declined" && (
          <InlineField
            label={t("trialFollowUp.declinedReasonLabel")}
            placeholder={t("trialFollowUp.declinedReasonPlaceholder")}
            value={r.declined_reason}
            maxLength={500}
            disabled={savingId === r.id}
            onSave={(v) => handleSaveText(r.id, "declined_reason", v)}
          />
        )}

        {/* 体験料の徴収記録。**料金を設定しているジムにだけ出す。**
            無料体験のジムに「体験料」の欄が出ても意味がないため。
            アプリは決済しない（店頭で受け取った結果を記録するだけ）。 */}
        {showFee && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <JapaneseYen className="w-3 h-3 shrink-0" />
              {t("trialFollowUp.feeLabel")}
            </div>
            <Select
              value={r.trial_fee_status ?? "未確認"}
              disabled={savingId === r.id}
              onValueChange={(v) => handleFeeChange(r.id, v as TrialFeeStatus)}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIAL_FEE_STATUSES.map((f) => (
                  <SelectItem key={f} value={f} className="text-xs">{t(`trialFollowUp.feeStatus.${feeI18nKey(f)}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {editingNoteId === r.id ? (
          <div className="space-y-2">
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t("trialFollowUp.notePlaceholder")}
              rows={3}
              className="text-xs resize-none"
              maxLength={500}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingNoteId(null)} disabled={savingId === r.id}>
                {t("common.cancelShort")}
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleSaveNote(r.id)} disabled={savingId === r.id}>
                <Save className="w-3 h-3" />
                {savingId === r.id ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        ) : r.follow_up_note ? (
          <button
            type="button"
            className="w-full text-left text-xs bg-muted/50 rounded-lg p-2 flex items-start gap-1.5 hover:bg-muted transition-colors"
            onClick={() => { setEditingNoteId(r.id); setNoteDraft(r.follow_up_note || ""); }}
          >
            <StickyNote className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-all">{r.follow_up_note}</span>
          </button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => { setEditingNoteId(r.id); setNoteDraft(""); }}
          >
            <StickyNote className="w-3 h-3" />
            {t("trialFollowUp.addNote")}
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4 sm:space-y-6 pb-24 md:pb-0">
      <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
        <UserCheck className="w-5 h-5 text-accent" />
        {t("trialFollowUp.title")}
      </h2>

      {/* 「アプリで決済できる」と誤解されないよう、料金を設定しているジムにだけ1回出す。 */}
      {showFee && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <JapaneseYen className="w-3.5 h-3.5 shrink-0 mt-px" />
          {t("trialFollowUp.feeHint")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-warning mb-1.5 sm:mb-2" />
            <p className="text-lg sm:text-2xl font-extrabold">{needsFollowUp.length}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{t("trialFollowUp.pendingCount")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-success mb-1.5 sm:mb-2" />
            <p className="text-lg sm:text-2xl font-extrabold">{conversion !== null ? `${conversion}%` : "—"}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{t("trialFollowUp.conversionRate")}</p>
          </CardContent>
        </Card>
      </div>

      {needsFollowUp.length > 0 && (
        <section>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
            {t("trialFollowUp.pendingSection")}
          </h3>
          <div className="space-y-2">
            {needsFollowUp.map(renderCard)}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
          {t("trialFollowUp.allSection")}
        </h3>
        {rows.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              {t("trialFollowUp.empty")}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map(renderCard)}
            {/* 上限に達したことを黙って隠さない。
                「古い体験が消えた」と誤解させないため */}
            {rows.length >= TRIAL_PAGE && (
              <p className="text-[11px] text-muted-foreground text-center py-2">
                {t("trialFollowUp.limited", { count: TRIAL_PAGE })}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default TrainerTrialFollowUps;
