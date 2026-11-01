import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Megaphone, Plus, Pencil, Trash2, Users, User as UserIcon, UserMinus, Clock, CheckCircle2,
  ImagePlus, Image as ImageIcon, X,
} from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { useTenant } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import IconPicker from "@/components/IconPicker";
import RenderIcon from "@/components/RenderIcon";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import AnnouncementAudiencePicker from "@/components/trainer/AnnouncementAudiencePicker";
import {
  type AudienceMode, audienceErrorKey, audienceLabel, audienceModeOf, audienceSaveArgs, audienceUserIdsOf,
} from "@/lib/announcementAudience";
import {
  ANNOUNCEMENT_IMAGE_ACCEPT, MAX_ANNOUNCEMENT_IMAGES,
  removeAnnouncementImages, signAnnouncementImageUrls, uploadAnnouncementImage,
} from "@/lib/announcementImages";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  icon: string;
  target: string;
  published_at: string;
  created_at: string;
  /** 配信対象で選んだ人（target が except / only のとき。src/lib/announcementAudience.ts） */
  announcement_audience?: { user_id: string }[] | null;
  /** 画像（非公開の置き場のパス。src/lib/announcementImages.ts） */
  image_paths?: string[] | null;
}

/** フォームに並んでいる画像1枚 */
interface FormImage {
  path: string;
  /** 小さく見せる用の URL（上げたばかりのものは手元の blob:、保存済みのものは署名つき URL。取れるまでは null） */
  previewUrl: string | null;
  /** このフォームで上げたもの（保存せずに閉じたら片付ける） */
  isNew: boolean;
}

const revokePreview = (img: FormImage) => {
  if (img.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
};

const TrainerAnnouncementManager = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { profiles } = useAllCustomerProfiles();
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [icon, setIcon] = useState("Bell");
  const [targetMode, setTargetMode] = useState<AudienceMode>("all");
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [publishedAt, setPublishedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 画像（宗本さん「お知らせで画像を送れる様にして」2026-11-01）。選んだ時点で置き場に上げ、保存でお知らせに結びつける
  const [images, setImages] = useState<FormImage[]>([]);
  /** 保存済みのお知らせから外した画像。保存できたら置き場から消す（保存しなければ消さない） */
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** フォームを開くたびに変わる番号。閉じたあとに終わったアップロード・署名を、次のフォームに混ぜない */
  const formSessionRef = useRef(0);
  /** 閉じるときの片付けで、最新の画像の一覧を読む（state は描画の時点の値なので） */
  const imagesRef = useRef<FormImage[]>([]);
  imagesRef.current = images;
  const submittingRef = useRef(false);
  submittingRef.current = submitting;

  // フォームを開いたまま別の画面へ移ったら、上げただけの画像を片付ける。
  // 🔴 保存の途中なら消さない（そのまま保存が通ると、お知らせが消えた画像を指してしまう）
  useEffect(() => () => {
    formSessionRef.current += 1;
    if (submittingRef.current) return;
    void removeAnnouncementImages(imagesRef.current.filter((img) => img.isNew).map((img) => img.path));
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data: anns } = await supabase
      .from("announcements")
      .select("*, announcement_audience(user_id)")
      .order("published_at", { ascending: false });
    const list = (anns as AnnouncementRow[] | null) ?? [];
    setItems(list);
    if (list.length > 0) {
      const ids = list.map((a) => a.id);
      const { data: reads } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .in("announcement_id", ids);
      const counts: Record<string, number> = {};
      ((reads as { announcement_id: string }[] | null) ?? []).forEach((r) => {
        counts[r.announcement_id] = (counts[r.announcement_id] || 0) + 1;
      });
      setReadCounts(counts);
    } else {
      setReadCounts({});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** 画像の state を空にする（置き場は触らない） */
  const clearImageState = () => {
    imagesRef.current.forEach(revokePreview);
    setImages([]);
    setRemovedPaths([]);
    setUploadingCount(0);
  };

  const resetForm = () => {
    setTitle(""); setBody(""); setIcon("Bell");
    setTargetMode("all"); setAudienceIds([]);
    setScheduleMode("now"); setPublishedAt("");
    setEditing(null);
    clearImageState();
  };

  /** フォームの番号を進める（前のフォームで遅れて終わった処理を、次のフォームに混ぜない） */
  const beginFormSession = () => {
    formSessionRef.current += 1;
    return formSessionRef.current;
  };

  const openCreate = () => { beginFormSession(); resetForm(); setShowForm(true); };

  /** 保存せずに閉じる。このフォームで上げた画像はどのお知らせにも付かないので、置き場から片付ける */
  const closeForm = () => {
    if (submitting) return;
    const drafts = imagesRef.current.filter((img) => img.isNew).map((img) => img.path);
    beginFormSession();
    resetForm();
    setShowForm(false);
    void removeAnnouncementImages(drafts);
  };

  const openEdit = (a: AnnouncementRow) => {
    const session = beginFormSession();
    clearImageState();
    const paths = (a.image_paths ?? []).filter(Boolean);
    setImages(paths.map((path) => ({ path, previewUrl: null, isNew: false })));
    if (paths.length > 0) {
      void signAnnouncementImageUrls(paths)
        .then((urls) => {
          if (formSessionRef.current !== session) return;
          setImages((prev) => prev.map((img) => (img.previewUrl ? img : { ...img, previewUrl: urls.get(img.path) ?? null })));
        })
        .catch(() => { /* 小さい表示が出ないだけ（画像は外せるし、保存もできる） */ });
    }
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setIcon(a.icon || "Bell");
    setTargetMode(audienceModeOf(a.target));
    setAudienceIds(audienceUserIdsOf(a.target, a.announcement_audience));
    const future = new Date(a.published_at).getTime() > Date.now();
    if (future) {
      setScheduleMode("later");
      // Format to local datetime-local value (YYYY-MM-DDTHH:mm)
      const d = new Date(a.published_at);
      const pad = (n: number) => String(n).padStart(2, "0");
      setPublishedAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setScheduleMode("now"); setPublishedAt("");
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!title.trim() || !body.trim()) { toast.error(t("announcement.errTitleBody")); return; }
    const audienceErr = audienceErrorKey(targetMode, audienceIds);
    if (audienceErr) { toast.error(t(audienceErr)); return; }
    if (scheduleMode === "later" && !publishedAt) { toast.error(t("announcement.errSchedule")); return; }
    // 上げ終わる前に保存すると、その画像が付かないまま配信される
    if (uploadingCount > 0) { toast.error(t("announcement.imageUploading")); return; }
    if (images.length > MAX_ANNOUNCEMENT_IMAGES) {
      toast.error(t("announcement.imageTooMany", { max: MAX_ANNOUNCEMENT_IMAGES }));
      return;
    }

    setSubmitting(true);
    // お知らせの行と「選んだ人」と画像を1つのトランザクションで書く（間に配信が挟まって、
    // 除く人がまだ居ない状態で全員に送らないように）。ジムは DB 側で自分の所属に決まる
    const { error } = await supabase.rpc("save_announcement", {
      p_title: title.trim(),
      p_body: body.trim(),
      p_icon: icon,
      p_published_at: scheduleMode === "later" ? new Date(publishedAt).toISOString() : new Date().toISOString(),
      ...audienceSaveArgs(targetMode, audienceIds),
      // 画像は毎回すべて渡す（空の配列＝画像なし）。古いアプリはこの引数を送らない＝DB 側で画像をそのまま残す
      p_image_paths: images.map((img) => img.path),
      ...(editing ? { p_id: editing.id } : {}),
    });

    setSubmitting(false);
    if (error) { toast.error(t("announcement.saveFailed", { msg: error.message })); return; }
    // 保存できたので、このお知らせから外した画像を置き場から消す
    void removeAnnouncementImages(removedPaths);
    toast.success(editing ? t("announcement.updatedToast") : t("announcement.publishedToast"));
    beginFormSession();
    setShowForm(false);
    resetForm();
    fetchAll();

    // 公開済み・未送信のお知らせをプッシュ配信（fire-and-forget）。
    // 即時公開ならすぐ届く。予約公開分は published_at 到来後に cron が同じ関数で配信する。
    // 送信済み管理（push_sent_at の原子的クレーム）はサーバー側なので二重送信しない。
    supabase.functions.invoke("push-announcements", { body: {} }).catch((e) =>
      console.error("push-announcements invoke failed (non-blocking):", e),
    );
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const paths = items.find((a) => a.id === deleteId)?.image_paths ?? [];
    setDeleting(true);
    const { data: deleted, error } = await supabase.from("announcements").delete().eq("id", deleteId).select("id");
    setDeleting(false);
    if (error) { toast.error(t("announcement.deleteFailed")); return; }
    // 本当に消えたときだけ、付いていた画像も置き場から消す（権限で消えなかったのに画像だけ消える、を避ける）
    if ((deleted ?? []).length > 0) void removeAnnouncementImages(paths);
    toast.success(t("announcement.deletedToast"));
    setDeleteId(null);
    fetchAll();
  };

  /** 選んだ画像を上げてフォームに並べる。4枚を超える分は上げない */
  const addImages = async (files: File[]) => {
    if (files.length === 0 || !tenant) return;
    const room = MAX_ANNOUNCEMENT_IMAGES - images.length - uploadingCount;
    if (files.length > room) toast.error(t("announcement.imageTooMany", { max: MAX_ANNOUNCEMENT_IMAGES }));
    const take = files.slice(0, Math.max(0, room));
    if (take.length === 0) return;
    const session = formSessionRef.current;
    const tenantId = tenant.id;
    setUploadingCount((n) => n + take.length);
    // 選んだ順に並べたいので1枚ずつ上げる（チラシの表・裏など、順番に意味がある）
    for (const file of take) {
      let uploaded: { path: string; previewUrl: string } | null = null;
      try {
        uploaded = await uploadAnnouncementImage(file, tenantId);
      } catch {
        if (formSessionRef.current === session) toast.error(t("announcement.imageUploadFailed"));
      }
      if (formSessionRef.current !== session) {
        // 上げている間にフォームを閉じた・保存した → この画像は使われないので片付けて、残りは上げない
        if (uploaded) {
          URL.revokeObjectURL(uploaded.previewUrl);
          void removeAnnouncementImages([uploaded.path]);
        }
        return;
      }
      const done = uploaded;
      if (done) setImages((prev) => [...prev, { path: done.path, previewUrl: done.previewUrl, isNew: true }]);
      setUploadingCount((n) => Math.max(0, n - 1));
    }
  };

  /** フォームから画像を外す。上げたばかりのものはすぐ消し、保存済みのものは保存できたときに消す */
  const removeImage = (img: FormImage) => {
    setImages((prev) => prev.filter((i) => i.path !== img.path));
    revokePreview(img);
    if (img.isNew) void removeAnnouncementImages([img.path]);
    else setRemovedPaths((prev) => (prev.includes(img.path) ? prev : [...prev, img.path]));
  };

  const targetLabel = (a: AnnouncementRow) => {
    const { key, values } = audienceLabel(
      a.target,
      audienceUserIdsOf(a.target, a.announcement_audience),
      (id) => profiles.find((p) => p.user_id === id)?.display_name,
    );
    return t(key, values);
  };
  const targetIcon = (target: string) => {
    const mode = audienceModeOf(target);
    const Icon = mode === "all" ? Users : mode === "except" ? UserMinus : UserIcon;
    return <Icon className="inline w-3 h-3 mr-0.5" />;
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><DumbbellLoader className="w-6 h-6 text-accent" /></div>;
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-accent" />
          {t("announcement.title")}
        </h1>
        <Button size="sm" onClick={openCreate} className="gap-1">
          <Plus className="w-4 h-4" /> {t("announcement.newBtn")}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{t("announcement.empty")}</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map((a) => {
            const scheduled = new Date(a.published_at).getTime() > Date.now();
            const reads = readCounts[a.id] || 0;
            return (
              <Card key={a.id}>
                <CardContent className="p-3 flex gap-3 items-start">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <RenderIcon name={a.icon} size={18} className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm break-all">{a.title}</p>
                      {scheduled ? (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />{t("announcement.scheduled")}
                        </span>
                      ) : (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <CheckCircle2 className="w-3 h-3" />{t("announcement.published")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(a.published_at), "yyyy/M/d HH:mm", { locale: ja })}
                      <span className="mx-1.5">·</span>
                      {targetIcon(a.target)}
                      {targetLabel(a)}
                      <span className="mx-1.5">·</span>
                      {t("announcement.readsCount", { count: reads })}
                      {(a.image_paths?.length ?? 0) > 0 && (
                        <>
                          <span className="mx-1.5">·</span>
                          <ImageIcon className="inline w-3 h-3 mr-0.5" />
                          {t("announcement.imagesBadge", { count: a.image_paths?.length ?? 0 })}
                        </>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap break-all">{a.body}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)} aria-label={t("announcement.editAria")}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(a.id)} aria-label={t("announcement.deleteAria")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={closeForm}>
          <div
            /* glass: 写真背景（theme-glass）でパネルが透過しないよう白フロスト面にする */
            className="bg-background glass rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">{editing ? t("announcement.editTitle") : t("announcement.newTitle")}</h2>

            <div className="space-y-1.5">
              <Label>{t("announcement.fieldTitle")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("announcement.titlePlaceholder")} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("announcement.fieldBody")}</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder={t("announcement.bodyPlaceholder")} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("announcement.fieldImages")}</Label>
              <div className="grid grid-cols-4 gap-2" data-testid="announcement-image-grid">
                {images.map((img, i) => (
                  <div key={img.path} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                    {img.previewUrl ? (
                      <img
                        src={img.previewUrl}
                        alt={t("announcement.imageAlt", { n: i + 1 })}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(img)}
                      disabled={submitting}
                      aria-label={t("announcement.removeImage", { n: i + 1 })}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {Array.from({ length: uploadingCount }, (_, i) => (
                  <div
                    key={`uploading-${i}`}
                    role="status"
                    aria-label={t("announcement.imageUploadingShort")}
                    className="aspect-square rounded-lg border border-border bg-muted flex items-center justify-center"
                  >
                    <DumbbellLoader className="w-5 h-5 text-accent" />
                  </div>
                ))}
                {images.length + uploadingCount < MAX_ANNOUNCEMENT_IMAGES && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting || !tenant}
                    className="aspect-square rounded-lg border-2 border-dashed border-border text-muted-foreground hover:bg-muted/40 flex flex-col items-center justify-center gap-1 text-[11px]"
                  >
                    <ImagePlus className="w-5 h-5" />
                    {t("announcement.addImage")}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ANNOUNCEMENT_IMAGE_ACCEPT}
                multiple
                className="hidden"
                data-testid="announcement-image-input"
                onChange={(e) => {
                  // 先に配列にしてから空にする（同じ画像を選び直しても change が来るように）
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void addImages(files);
                }}
              />
              <p className="text-xs text-muted-foreground">{t("announcement.imagesHint", { max: MAX_ANNOUNCEMENT_IMAGES })}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("announcement.fieldIcon")}</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>

            {/* 切り替えたら選び直す（「除く」で選んだ人が「個別」の送り先に化けないように） */}
            <AnnouncementAudiencePicker
              mode={targetMode}
              onModeChange={(m) => { if (m !== targetMode) { setTargetMode(m); setAudienceIds([]); } }}
              selected={audienceIds}
              onChange={setAudienceIds}
              customers={profiles}
            />

            <div className="space-y-1.5">
              <Label>{t("announcement.fieldSchedule")}</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={scheduleMode === "now" ? "default" : "outline"} onClick={() => setScheduleMode("now")}>{t("announcement.scheduleNow")}</Button>
                <Button type="button" size="sm" variant={scheduleMode === "later" ? "default" : "outline"} onClick={() => setScheduleMode("later")}>{t("announcement.scheduleLater")}</Button>
              </div>
              {scheduleMode === "later" && (
                <Input
                  type="datetime-local"
                  className="mt-2"
                  value={publishedAt}
                  onChange={(e) => setPublishedAt(e.target.value)}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeForm} disabled={submitting}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && <DumbbellLoader className="w-4 h-4 mr-1" />}
                {editing ? t("announcement.btnUpdate") : t("announcement.btnPublish")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("announcement.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("announcement.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting && <DumbbellLoader className="w-4 h-4 mr-1" />}{t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerAnnouncementManager;