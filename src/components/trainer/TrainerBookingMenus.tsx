import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, CalendarClock, LayoutList, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useTenantStaff } from "@/hooks/useTenantStaff";
import { useStaffSchedules } from "@/hooks/useStaffSchedules";
import { useBookingMenus } from "@/hooks/useBookingMenus";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { menuStartLabel, type BookingMenu } from "@/lib/bookingMenus";

/**
 * 予約メニュー（`booking_menus`・2026-10-28）を編集する。仕組みは src/lib/bookingMenus.ts と
 * `supabase/migrations/20261028030000_booking_menus.sql`。
 *
 * 宗本さん: 「お客様用にも、筋トレの予約とピラティスの予約で分けて予約できるようにしてほしい」
 *
 * - メニューが2つ以上オンになると、お客様の予約画面に「メニュー」の選択が出る（1つだけなら今まで通り）
 * - 担当を決めたメニューは、その人のシフト（スタッフ別のシフト）の時間だけ予約できる
 * - 担当を決めたメニューの時間を「専用」にするか「先着順」にするか（tenants.menu_staff_hours_exclusive）
 * - 開始日（starts_on・2026-10-29）: その日より前は、お客様がそのメニューを予約できない。専用の時間も
 *   その日から（「今オンにして、11/25 から予約できる」ため）。空欄はすぐ
 *
 * 保存は1操作ずつすぐ書く（行が少なく、並べ替え・オン/オフを押したそばから効くほうが分かりやすい）。
 * 🔴 予約に使われたメニューは消せない（DB の外部キー）。やめるときはオフにする。
 */
const NO_STAFF = "__none__";
const NAME_MAX = 30;

const TrainerBookingMenus = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const { staff } = useTenantStaff();
  const { schedules } = useStaffSchedules();
  const { menus, refetch } = useBookingMenus();
  const [name, setName] = useState("");
  const [staffId, setStaffId] = useState(NO_STAFF);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BookingMenu | null>(null);

  if (!tenant) return null;

  const staffName = (id: string) => staff.find((s) => s.user_id === id)?.display_name ?? t("common.unknown");
  const hasShift = (id: string) => schedules.some((s) => s.user_id === id);
  const exclusive = tenant.menu_staff_hours_exclusive !== false;
  // シフト未設定の知らせは担当ごとに1回（同じ先生が複数のメニューを持つとき、全部の行に出さない）
  const noShiftWarnAt = new Set(
    menus
      .filter((m) => m.is_active && m.staff_user_id && !hasShift(m.staff_user_id))
      .filter((m, i, arr) => arr.findIndex((x) => x.staff_user_id === m.staff_user_id) === i)
      .map((m) => m.id),
  );
  const anyStaffed = menus.some((m) => m.is_active && m.staff_user_id);

  /** 書いて、失敗なら知らせる。成功なら読み直す */
  const write = async (op: PromiseLike<{ error: { code?: string } | null }>, okMessage?: string): Promise<boolean> => {
    setBusy(true);
    const { error } = await op;
    setBusy(false);
    if (error) {
      toast.error(t(error.code === "23503" ? "bookingMenus.errorInUse" : "bookingMenus.errorSave"));
      return false;
    }
    if (okMessage) toast.success(okMessage);
    void refetch();
    return true;
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed.length > NAME_MAX) {
      toast.error(t("bookingMenus.errorNameTooLong", { max: NAME_MAX }));
      return;
    }
    const nextOrder = menus.reduce((max, m) => Math.max(max, m.sort_order), -1) + 1;
    const ok = await write(
      supabase.from("booking_menus").insert({
        tenant_id: tenant.id, name: trimmed, staff_user_id: staffId === NO_STAFF ? null : staffId, sort_order: nextOrder,
      }),
      t("bookingMenus.addedToast", { name: trimmed }),
    );
    if (ok) {
      setName("");
      setStaffId(NO_STAFF);
    }
  };

  const update = (m: BookingMenu, patch: Partial<Pick<BookingMenu, "name" | "staff_user_id" | "is_active" | "starts_on">>) =>
    write(supabase.from("booking_menus").update(patch).eq("id", m.id));

  const rename = (m: BookingMenu, value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === m.name) return;
    if (trimmed.length > NAME_MAX) {
      toast.error(t("bookingMenus.errorNameTooLong", { max: NAME_MAX }));
      return;
    }
    void update(m, { name: trimmed });
  };

  /** 開始日。日付欄は入力の途中でも変わるので、欄を離れたときに保存する（空欄＝すぐ） */
  const setStartsOn = (m: BookingMenu, value: string) => {
    const next = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    if (next === (m.starts_on ?? null)) return;
    void update(m, { starts_on: next });
  };

  /** 並べ替え。並び順を 0,1,2… に振り直す（同じ番号が並んでいると入れ替わらないため） */
  const move = async (index: number, delta: -1 | 1) => {
    const next = [...menus];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    const results = await Promise.all(
      next.map((m, i) => (m.sort_order === i ? null : supabase.from("booking_menus").update({ sort_order: i }).eq("id", m.id))),
    );
    setBusy(false);
    if (results.some((r) => r?.error)) toast.error(t("bookingMenus.errorSave"));
    void refetch();
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await write(supabase.from("booking_menus").delete().eq("id", target.id), t("bookingMenus.deletedToast", { name: target.name }));
  };

  const setExclusive = async (on: boolean) => {
    setBusy(true);
    const { error } = await supabase.from("tenants").update({ menu_staff_hours_exclusive: on }).eq("id", tenant.id);
    setBusy(false);
    if (error) {
      toast.error(t("bookingMenus.errorSave"));
      return;
    }
    toast.success(t(on ? "bookingMenus.exclusiveOnToast" : "bookingMenus.exclusiveOffToast"));
    void refetchTenant();
  };

  const staffSelect = (value: string, onChange: (v: string) => void, ariaLabel: string) => (
    <Select value={value} onValueChange={onChange} disabled={busy}>
      <SelectTrigger className="h-9 flex-1 min-w-0" aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_STAFF}>{t("bookingMenus.staffNone")}</SelectItem>
        {staff.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.display_name}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-2" data-testid="booking-menus-card">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("bookingMenus.title")}</h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("bookingMenus.desc")}</p>

          {menus.length > 0 && (
            <ul className="space-y-2">
              {menus.map((m, i) => (
                <li key={m.id} className="rounded-lg border border-border p-2.5 space-y-2" data-testid="booking-menu-row">
                  <div className="flex items-center gap-2">
                    <Input
                      key={m.name}
                      defaultValue={m.name}
                      maxLength={NAME_MAX}
                      onBlur={(e) => rename(m, e.target.value)}
                      aria-label={t("bookingMenus.nameAria")}
                      className="h-9 flex-1 min-w-0"
                    />
                    <Switch
                      checked={m.is_active}
                      disabled={busy}
                      onCheckedChange={(on) => void update(m, { is_active: on })}
                      aria-label={t("bookingMenus.activeAria", { name: m.name })}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground shrink-0">{t("bookingMenus.staffLabel")}</span>
                    {staffSelect(m.staff_user_id ?? NO_STAFF, (v) => void update(m, { staff_user_id: v === NO_STAFF ? null : v }),
                      t("bookingMenus.staffAria", { name: m.name }))}
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={busy || i === 0}
                      onClick={() => void move(i, -1)} aria-label={t("bookingMenus.moveUp", { name: m.name })}>
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={busy || i === menus.length - 1}
                      onClick={() => void move(i, 1)} aria-label={t("bookingMenus.moveDown", { name: m.name })}>
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" disabled={busy}
                      onClick={() => setDeleteTarget(m)} aria-label={t("bookingMenus.deleteAria", { name: m.name })}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground shrink-0">{t("bookingMenus.startsOnLabel")}</span>
                    <Input
                      key={`${m.id}-${m.starts_on ?? ""}`}
                      type="date"
                      defaultValue={m.starts_on ?? ""}
                      disabled={busy}
                      onBlur={(e) => setStartsOn(m, e.target.value)}
                      aria-label={t("bookingMenus.startsOnAria", { name: m.name })}
                      className="h-9 w-40"
                      data-testid="booking-menu-starts-on-input"
                    />
                    {m.starts_on && (
                      <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0" disabled={busy}
                        onClick={() => void update(m, { starts_on: null })}>
                        {t("bookingMenus.startsOnClear")}
                      </Button>
                    )}
                  </div>
                  {m.starts_on && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("bookingMenus.startsOnSetHint", { date: menuStartLabel(m.starts_on) })}
                    </p>
                  )}
                  {/* 担当のシフトが未設定だと、営業時間中いつでも予約でき、専用の時間も持たない */}
                  {m.staff_user_id && noShiftWarnAt.has(m.id) && (
                    <p className="text-[11px] text-warning flex items-start gap-1.5" data-testid="booking-menu-no-shift">
                      <CalendarClock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {t("bookingMenus.noShiftWarning", { name: staffName(m.staff_user_id) })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
            <div className="flex items-center gap-2">
              <LayoutList className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX}
                placeholder={t("bookingMenus.namePlaceholder")}
                aria-label={t("bookingMenus.nameAria")}
                className="h-9 flex-1 min-w-0"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">{t("bookingMenus.staffLabel")}</span>
              {staffSelect(staffId, setStaffId, t("bookingMenus.staffLabel"))}
              <Button type="button" size="sm" className="h-9 shrink-0" disabled={busy || !name.trim()} onClick={() => void add()}>
                <Plus className="w-4 h-4 mr-1" />
                {t("bookingMenus.add")}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t("bookingMenus.staffHint")}</p>
          </div>

          {anyStaffed && (
            <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{t("bookingMenus.exclusiveTitle")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(exclusive ? "bookingMenus.exclusiveOn" : "bookingMenus.exclusiveOff")}
                </p>
              </div>
              <Switch
                checked={exclusive}
                disabled={busy}
                onCheckedChange={(on) => void setExclusive(on)}
                aria-label={t("bookingMenus.exclusiveTitle")}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bookingMenus.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("bookingMenus.deleteConfirm", { name: deleteTarget?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="w-full sm:w-auto">{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => void remove()} className="w-full sm:w-auto">{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrainerBookingMenus;
