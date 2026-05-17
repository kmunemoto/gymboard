import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getAvatarImage } from "@/lib/avatarSystem";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

interface Props {
  open: boolean;
  onSelect: (gender: "male" | "female") => Promise<void> | void;
}

const AvatarGenderSetupDialog = ({ open, onSelect }: Props) => {
  const [saving, setSaving] = useState<"male" | "female" | null>(null);

  const handle = async (g: "male" | "female") => {
    if (saving) return;
    setSaving(g);
    try {
      await onSelect(g);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="text-center text-base font-extrabold flex items-center justify-center gap-1.5">
          <Sparkles className="w-4 h-4" style={{ color: "hsl(174, 65%, 50%)" }} />
          アバターの性別を選んでください
        </DialogTitle>
        <p className="text-xs text-muted-foreground text-center -mt-1">
          いつでも設定から変更できます
        </p>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {(["female", "male"] as const).map((g) => {
            const isSaving = saving === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => handle(g)}
                disabled={!!saving}
                className="rounded-2xl border-2 border-border bg-card p-3 flex flex-col items-center transition hover:border-accent hover:bg-accent/10 disabled:opacity-60"
              >
                <div
                  className="w-28 h-28 rounded-2xl overflow-hidden flex items-center justify-center"
                  style={{ backgroundColor: "rgba(16,185,129,0.1)" }}
                >
                  <img
                    src={getAvatarImage("rookie", g, "orange")}
                    alt={g}
                    className="w-full h-full object-cover pixel-avatar"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = "/avatars/rookie.png";
                    }}
                  />
                </div>
                <span className="mt-2 text-sm font-bold">
                  {g === "female" ? "女性" : "男性"}
                </span>
                {isSaving && (
                  <Loader2 className="w-4 h-4 animate-spin mt-1 text-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AvatarGenderSetupDialog;