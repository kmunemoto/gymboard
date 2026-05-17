import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGymSettings } from "@/hooks/useGymSettings";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, Trash2, Image, User, Save, LogOut, MessageCircle, CheckCircle2, Unlink, Calendar, Loader2, RefreshCw, Settings } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface TrainerGymSettingsProps {
  onSignOut: () => void;
}

const TrainerGymSettings = ({ onSignOut }: TrainerGymSettingsProps) => {
  const { settings, updateLogoUrl, refetch } = useGymSettings();
  const { user } = useAuth();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);




  const isLineLinked = !!profile?.line_user_id;

  // Google Calendar state
  const [gcalLinked, setGcalLinked] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  const checkGcalStatus = async () => {
    if (!user) return;
    setGcalLoading(true);
    const { data } = await supabase
      .from("google_calendar_tokens" as any)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    setGcalLinked(!!data);
    setGcalLoading(false);
  };

  useEffect(() => {
    checkGcalStatus();
  }, [user]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "line-link-result") {
        if (e.data.success) {
          toast.success("LINE連携が完了しました！");
          refetchProfile();
        } else {
          toast.error("LINE連携に失敗しました");
        }
      }
      if (e.data?.type === "google-calendar-result") {
        if (e.data.success) {
          toast.success("Googleカレンダー連携が完了しました！");
          setGcalLinked(true);
        } else {
          toast.error("Googleカレンダー連携に失敗しました");
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refetchProfile]);

  // --- Handlers ---
  const handleSaveName = async () => {
    if (!user || !displayName.trim()) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("user_id", user.id);
    if (error) toast.error("名前の保存に失敗しました");
    else toast.success("表示名を更新しました");
    setSavingName(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("画像ファイルを選択してください"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("ファイルサイズは2MB以下にしてください"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `logo_${Date.now()}.${ext}`;
      await supabase.storage.from("gym-assets").remove([filePath]);
      const { error: uploadError } = await supabase.storage.from("gym-assets").upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("gym-assets").getPublicUrl(filePath);
      const url = `${urlData.publicUrl}?t=${Date.now()}`;
      const err = await updateLogoUrl(url);
      if (err) throw err;
      toast.success("ロゴを更新しました");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "アップロードに失敗しました");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    setUploading(true);
    try {
      const { data: files } = await supabase.storage.from("gym-assets").list();
      if (files && files.length > 0) {
        const logoFiles = files.filter((f) => f.name.startsWith("logo"));
        if (logoFiles.length > 0) await supabase.storage.from("gym-assets").remove(logoFiles.map((f) => f.name));
      }
      const err = await updateLogoUrl(null);
      if (err) throw err;
      toast.success("ロゴを削除しました");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "削除に失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleLineLink = () => {
    if (!user) return;
    const channelId = "2009770713";
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const redirectUri = encodeURIComponent(`${supabaseUrl}/functions/v1/line-login-callback`);
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${channelId}&redirect_uri=${redirectUri}&state=${user.id}&scope=profile%20openid`;
    window.open(lineAuthUrl, "line-link", "width=500,height=700");
  };

  const handleLineUnlink = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ line_user_id: null }).eq("user_id", user.id);
    if (error) toast.error("LINE連携の解除に失敗しました");
    else { toast.success("LINE連携を解除しました"); refetchProfile(); }
  };

  const handleGcalLink = async () => {
    if (!user) return;
    const popup = window.open("about:blank", "gcal-link", "width=500,height=700");
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-auth-url", { body: { user_id: user.id } });
      if (error || !data?.url) { popup?.close(); toast.error("Google認証URLの取得に失敗しました"); return; }
      if (popup) popup.location.href = data.url;
      else window.location.href = data.url;
    } catch (e) { popup?.close(); toast.error("エラーが発生しました"); }
  };

  const handleGcalUnlink = async () => {
    if (!user) return;
    const { error } = await supabase.from("google_calendar_tokens" as any).delete().eq("user_id", user.id);
    if (error) toast.error("連携解除に失敗しました");
    else { toast.success("Googleカレンダー連携を解除しました"); setGcalLinked(false); }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync", { body: { action: "sync_all" } });
      if (error) throw error;
      toast.success(`${data?.synced || 0}件の予約をGoogleカレンダーに同期しました`);
    } catch (e) { toast.error("同期に失敗しました"); }
    setSyncing(false);
  };




  return (
    <div className="space-y-6 pb-24 md:pb-0 max-w-lg">
      <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
        <Settings className="w-5 h-5 text-accent" />
        ジム設定
      </h2>

      {/* === プロフィール === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">プロフィール</h3>

        {/* トレーナー表示名 */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="font-bold text-sm">トレーナー表示名</h3>
                <p className="text-xs text-muted-foreground">ダッシュボードやチャット画面に表示されます</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例：山本 太郎" className="flex-1" />
              <Button onClick={handleSaveName} disabled={savingName || !displayName.trim()} size="sm" className="h-10">
                <Save className="w-4 h-4 mr-1" />
                {savingName ? "保存中..." : "保存"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ロゴ画像 */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <Image className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="font-bold text-sm">ロゴ画像</h3>
                <p className="text-xs text-muted-foreground">推奨: 200×200px以上、2MB以下</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 shrink-0">
                {settings?.logo_url ? (
                  <img src={settings.logo_url} alt="ジムロゴ" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">未設定</span>
                )}
              </div>
              <div className="flex gap-2 flex-1">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} size="sm" className="flex-1">
                  <Upload className="w-4 h-4 mr-1" />
                  {uploading ? "処理中..." : settings?.logo_url ? "変更" : "アップロード"}
                </Button>
                {settings?.logo_url && (
                  <Button variant="destructive" onClick={handleDelete} disabled={uploading} size="sm">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* === 連携設定 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">外部サービス連携</h3>

        {/* Googleカレンダー */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm mb-0.5">Googleカレンダー連携</h3>
                <p className="text-xs text-muted-foreground mb-2">予約を自動的にGoogleカレンダーに登録します</p>
                {gcalLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : gcalLinked ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-500">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 連携済み
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncing}>
                        {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                        一括同期
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleGcalUnlink}>
                        <Unlink className="w-3.5 h-3.5 mr-1" /> 解除
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" onClick={handleGcalLink} className="bg-blue-500 hover:bg-blue-600 text-white">
                    <Calendar className="w-4 h-4 mr-1" /> 連携する
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* LINE */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-4 h-4 text-[#06C755]" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm mb-0.5">LINE連携</h3>
                <p className="text-xs text-muted-foreground mb-2">新規予約・キャンセルなどの通知をLINEで受け取れます</p>
                {isLineLinked ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#06C755]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 連携済み
                    </div>
                    <Button size="sm" variant="outline" onClick={handleLineUnlink}>
                      <Unlink className="w-3.5 h-3.5 mr-1" /> 解除
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" onClick={handleLineLink} className="bg-[#06C755] hover:bg-[#05b34c] text-white">
                    <MessageCircle className="w-4 h-4 mr-1" /> 連携する
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>




      {/* === ログアウト === */}
      <section>
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive font-bold"
          onClick={onSignOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          ログアウト
        </Button>
      </section>
    </div>
  );
};

export default TrainerGymSettings;