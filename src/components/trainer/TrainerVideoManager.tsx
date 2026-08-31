import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Video as VideoIcon, Plus, Pencil, Trash2, Clock, ExternalLink, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { openExternalUrl } from "@/lib/nativeBridge";
import { useGymVideos, type GymVideo, type GymVideoInput } from "@/hooks/useGymVideos";
import { parseVideoUrl, formatDuration, parseDurationInput } from "@/lib/videoEmbed";

// ジムがお客様に配る動画の管理（自宅ストレッチ等）。
//
// 🔴 動画ファイルは受け取らない。YouTube / Vimeo の**限定公開URLを貼る**方式。
//    理由は supabase/migrations/20260831010000_gym_videos.sql の冒頭に書いてある
//    （尺・容量・転送量の原価がジムボード側に乗らないようにするため）。
//
// 予約公開はお知らせと同じで published_at 1本。未来の日時ならお客様には出ない。

/** カテゴリーの候補。自由入力なので、これ以外も書ける（exercises.category と同じ扱い） */
const CATEGORY_PRESETS = ["首・肩", "背中・腰", "股関節・お尻", "脚", "体幹", "全身", "その他"];

const emptyForm = {
  title: "",
  description: "",
  videoUrl: "",
  category: CATEGORY_PRESETS[0],
  duration: "",
  scheduleMode: "now" as "now" | "later",
  publishedAt: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const TrainerVideoManager = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { items, loading, error, create, update, remove, refetch } = useGymVideos({ includeUnpublished: true });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GymVideo | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const set = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // 入力中のURLをその場で解析して、貼り間違いを保存前に気づけるようにする
  const preview = useMemo(() => parseVideoUrl(form.videoUrl), [form.videoUrl]);
  const urlTouched = form.videoUrl.trim().length > 0;

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (v: GymVideo) => {
    setEditing(v);
    const future = new Date(v.published_at).getTime() > Date.now();
    setForm({
      title: v.title,
      description: v.description ?? "",
      videoUrl: v.video_url,
      category: v.category,
      duration: v.duration_seconds == null ? "" : String(v.duration_seconds),
      scheduleMode: future ? "later" : "now",
      publishedAt: future ? toLocalInput(v.published_at) : "",
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!form.title.trim()) { toast.error(t("gymVideo.errTitle")); return; }
    if (!preview) { toast.error(t("gymVideo.errUrl")); return; }
    if (form.scheduleMode === "later" && !form.publishedAt) { toast.error(t("gymVideo.errSchedule")); return; }
    const duration = parseDurationInput(form.duration);
    if (form.duration.trim() && duration === null) { toast.error(t("gymVideo.errDuration")); return; }

    const payload: GymVideoInput = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      // 🔴 貼られたURLをそのまま持つ。埋め込みURLは表示のたびに videoEmbed が組み直す
      //    （提供元が埋め込みの形を変えても、DBを書き換えずに追随できる）
      video_url: form.videoUrl.trim(),
      category: form.category.trim() || "その他",
      duration_seconds: duration,
      // 並び順は「一番下に足す」。上下ボタンで入れ替える
      sort_order: editing ? editing.sort_order : (items.reduce((m, v) => Math.max(m, v.sort_order), 0) + 1),
      published_at:
        form.scheduleMode === "later" ? new Date(form.publishedAt).toISOString() : new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      if (editing) await update(editing.id, payload);
      else await create(payload);
      toast.success(editing ? t("gymVideo.updatedToast") : t("gymVideo.createdToast"));
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (e) {
      toast.error(t("gymVideo.saveFailed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await remove(deleteId);
      toast.success(t("gymVideo.deletedToast"));
      setDeleteId(null);
    } catch (e) {
      toast.error(t("gymVideo.deleteFailed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setDeleting(false);
    }
  };

  /** 隣と sort_order を入れ替える。一覧の並びがそのままお客様側の並びになる */
  const swap = async (index: number, dir: -1 | 1) => {
    const a = items[index];
    const b = items[index + dir];
    if (!a || !b) return;
    try {
      await update(a.id, { ...toInput(a), sort_order: b.sort_order });
      await update(b.id, { ...toInput(b), sort_order: a.sort_order });
    } catch (e) {
      toast.error(t("gymVideo.saveFailed", { msg: e instanceof Error ? e.message : String(e) }));
      refetch();
    }
  };

  const toInput = (v: GymVideo): GymVideoInput => ({
    title: v.title,
    description: v.description,
    video_url: v.video_url,
    category: v.category,
    duration_seconds: v.duration_seconds,
    sort_order: v.sort_order,
    published_at: v.published_at,
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20"><DumbbellLoader className="w-6 h-6 text-accent" /></div>;
  }

  return (
    <div className="pb-24 md:pb-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <VideoIcon className="w-5 h-5 text-accent" />
            {t("gymVideo.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">{t("gymVideo.desc")}</p>
        </div>
        <Button onClick={openNew} size="sm" className="h-10 shrink-0">
          <Plus className="w-4 h-4 mr-1" />
          {t("gymVideo.add")}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t("gymVideo.loadFailed", { msg: error })}</span>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t("gymVideo.urlHelp")}</p>

            <div className="space-y-1.5">
              <Label htmlFor="gv-url" className="text-xs font-bold">{t("gymVideo.urlLabel")}</Label>
              <Input
                id="gv-url"
                value={form.videoUrl}
                onChange={(e) => set("videoUrl", e.target.value)}
                placeholder="https://youtu.be/..."
                inputMode="url"
                autoComplete="off"
              />
              {urlTouched && !preview && (
                <p className="text-[11px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {t("gymVideo.errUrl")}
                </p>
              )}
              {preview && (
                /* 貼った直後にここで再生できることを確かめてから保存してもらう */
                <div className="relative w-full overflow-hidden rounded-lg bg-black mt-1" style={{ aspectRatio: "16 / 9" }}>
                  <iframe
                    key={preview.embedUrl}
                    src={preview.embedUrl}
                    title={t("gymVideo.previewTitle")}
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gv-title" className="text-xs font-bold">{t("gymVideo.titleLabel")}</Label>
              <Input
                id="gv-title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder={t("gymVideo.titlePlaceholder")}
                maxLength={60}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gv-desc" className="text-xs font-bold">{t("gymVideo.descLabel")}</Label>
              <Textarea
                id="gv-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={t("gymVideo.descPlaceholder")}
                rows={3}
                maxLength={1000}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gv-category" className="text-xs font-bold">{t("gymVideo.categoryLabel")}</Label>
                <Input
                  id="gv-category"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  list="gv-category-presets"
                  maxLength={30}
                />
                <datalist id="gv-category-presets">
                  {CATEGORY_PRESETS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gv-duration" className="text-xs font-bold">{t("gymVideo.durationLabel")}</Label>
                <Input
                  id="gv-duration"
                  value={form.duration}
                  onChange={(e) => set("duration", e.target.value)}
                  placeholder="3:20"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("gymVideo.scheduleLabel")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={form.scheduleMode === "now" ? "default" : "outline"}
                  size="sm"
                  className="h-9 flex-1"
                  onClick={() => set("scheduleMode", "now")}
                >
                  {t("gymVideo.scheduleNow")}
                </Button>
                <Button
                  type="button"
                  variant={form.scheduleMode === "later" ? "default" : "outline"}
                  size="sm"
                  className="h-9 flex-1"
                  onClick={() => set("scheduleMode", "later")}
                >
                  {t("gymVideo.scheduleLater")}
                </Button>
              </div>
              {form.scheduleMode === "later" && (
                <Input
                  type="datetime-local"
                  value={form.publishedAt}
                  onChange={(e) => set("publishedAt", e.target.value)}
                />
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSubmit} disabled={submitting} size="sm" className="h-10 flex-1">
                {submitting ? t("common.saving") : t("common.save")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10"
                onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm); }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && !showForm ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("gymVideo.empty")}</div>
      ) : (
        <div className="space-y-2">
          {items.map((v, i) => {
            const parsed = parseVideoUrl(v.video_url);
            const duration = formatDuration(v.duration_seconds);
            const scheduled = new Date(v.published_at).getTime() > Date.now();
            return (
              <Card key={v.id}>
                <CardContent className="p-3 flex gap-3">
                  <div className="w-24 shrink-0 rounded-lg overflow-hidden bg-muted relative" style={{ aspectRatio: "16 / 9" }}>
                    {/* 代替の絵を常に下に敷く（サムネが読めなくても壊れた画像を出さない） */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <VideoIcon className="w-5 h-5 text-muted-foreground" />
                    </div>
                    {parsed?.thumbnailUrl && (
                      <img
                        src={parsed.thumbnailUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-bold leading-tight break-all">{v.title}</p>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                      <span className="px-1.5 py-0.5 rounded bg-muted font-bold">{v.category}</span>
                      {duration && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{duration}</span>}
                      {scheduled && <span className="text-warning font-bold">{t("gymVideo.scheduled")}</span>}
                      {!parsed && (
                        <span className="text-destructive font-bold flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" />
                          {t("gymVideo.badUrl")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 pt-1 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => openEdit(v)} aria-label={t("common.edit")}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive" onClick={() => setDeleteId(v.id)} aria-label={t("common.delete")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                      {parsed && (
                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => openExternalUrl(parsed.watchUrl)} aria-label={t("gymVideo.openExternal")}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 px-2" disabled={i === 0} onClick={() => swap(i, -1)} aria-label={t("gymVideo.moveUp")}>
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 px-2" disabled={i === items.length - 1} onClick={() => swap(i, 1)} aria-label={t("gymVideo.moveDown")}>
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gymVideo.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("gymVideo.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? t("common.saving") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerVideoManager;
