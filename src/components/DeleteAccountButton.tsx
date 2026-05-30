import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const DeleteAccountButton = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("delete_my_account" as any);
      if (error) {
        if (error.message?.includes("Owner cannot delete")) {
          toast.error("オーナーはアカウントを削除できません。先にジムを削除するか、別のオーナーに引き継いでください");
        } else {
          toast.error("アカウントの削除に失敗しました");
        }
        setDeleting(false);
        return;
      }
      await signOut();
      toast.success("アカウントが削除されました");
      navigate("/auth");
    } catch (e) {
      toast.error("アカウントの削除に失敗しました");
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive font-bold"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          アカウントを削除する
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>本当に削除しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            アカウントを削除すると、すべてのデータが失われます。この操作は取り消せません。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? <DumbbellLoader className="w-4 h-4 animate-spin" /> : "削除する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteAccountButton;
