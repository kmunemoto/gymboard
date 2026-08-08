import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCheck2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { getJSTToday } from "@/lib/timezone";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { AGREEMENT_PRESETS, useMemberAgreements } from "@/hooks/useMemberAgreements";

/**
 * 契約・同意の記録（`member_agreements`）。
 *
 * ── 🔴 同意「書」ではなく同意の「記録」 ─────────────────────
 * 電子署名でも契約書の保管でもない。「いつ・何に・同意を得た」という
 * 事実をジムが控えるための台帳。規約の本文はここに入れない。
 * **これを根拠に責任の所在を主張できる類のものではない**ので、
 * 画面にもそう読める文言は書かない（`member.agreementsNote` がその注記）。
 */

interface MemberAgreementsSectionProps {
  clientId: string;
}

const MemberAgreementsSection = ({ clientId }: MemberAgreementsSectionProps) => {
  const { t } = useTranslation();
  const { agreements, loading, addAgreement, deleteAgreement } = useMemberAgreements(clientId);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<string>(AGREEMENT_PRESETS[0]);
  const [agreedOn, setAgreedOn] = useState(getJSTToday());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const openDialog = () => {
    setTitle(AGREEMENT_PRESETS[0]);
    setAgreedOn(getJSTToday());
    setNote("");
    setOpen(true);
  };

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed) { toast.error(t("member.agreementTitleRequired")); return; }
    if (trimmed.length > 100) { toast.error(t("member.agreementTitleTooLong")); return; }
    if (!agreedOn) { toast.error(t("member.agreedOnRequired")); return; }
    if (note.trim().length > 1000) { toast.error(t("member.noteTooLong")); return; }
    setSaving(true);
    const { error } = await addAgreement({ userId: clientId, title: trimmed, agreedOn, note: note.trim() || null });
    setSaving(false);
    if (error) { toast.error(t("member.saveFailed")); return; }
    setOpen(false);
    toast.success(t("member.agreementSaved"));
  };

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <FileCheck2 className="w-3.5 h-3.5" />
        {t("member.agreementsTitle")}
      </h2>
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <Button onClick={openDialog} variant="outline" className="w-full h-11 gap-1.5">
            <Plus className="w-4 h-4" />
            {t("member.addAgreement")}
          </Button>

          {loading ? (
            <div className="flex justify-center py-6"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
          ) : agreements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("member.noAgreements")}</p>
          ) : (
            <div className="space-y-2">
              {agreements.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-all">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.agreed_on}</p>
                    {a.note && <p className="text-xs text-muted-foreground/80 break-all mt-0.5">{a.note}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setDeleteTarget(a.id)}
                    aria-label={t("common.deleteAction")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">{t("member.agreementsNote")}</p>
        </CardContent>
      </Card>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("member.addAgreementTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("member.addAgreementDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`atitle-${clientId}`}>
                {t("member.agreementTitleLabel")}
              </label>
              {/* よく使う名目は候補から。ジムごとに増えるので自由入力も残す */}
              <select
                value={AGREEMENT_PRESETS.includes(title as typeof AGREEMENT_PRESETS[number]) ? title : "__custom__"}
                onChange={(e) => setTitle(e.target.value === "__custom__" ? "" : e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring mb-2"
              >
                {AGREEMENT_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value="__custom__">{t("member.agreementCustom")}</option>
              </select>
              <Input
                id={`atitle-${clientId}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("member.agreementTitlePlaceholder")}
                className="h-11 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`adate-${clientId}`}>
                {t("member.agreedOnLabel")}
              </label>
              <Input id={`adate-${clientId}`} type="date" value={agreedOn} onChange={(e) => setAgreedOn(e.target.value)} className="h-11 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`anote-${clientId}`}>
                {t("member.noteLabel")}
              </label>
              <Textarea
                id={`anote-${clientId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("member.agreementNotePlaceholder")}
                className="text-sm"
                rows={3}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={(e) => { e.preventDefault(); save(); }}>
              {t("member.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("member.deleteAgreementTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("member.deleteAgreementDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return;
                const { error } = await deleteAgreement(deleteTarget);
                setDeleteTarget(null);
                if (error) toast.error(t("member.saveFailed"));
              }}
            >
              {t("common.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default MemberAgreementsSection;
