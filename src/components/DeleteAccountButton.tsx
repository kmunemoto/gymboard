import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
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
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const DeleteAccountButton = () => {
  const { t } = useTranslation();
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
          toast.error(t("deleteAccountBtn.ownerCannotDelete"));
        } else {
          toast.error(t("deleteAccountBtn.deleteFailed"));
        }
        setDeleting(false);
        return;
      }
      await signOut();
      toast.success(t("deleteAccountBtn.deleted"));
      navigate("/auth");
    } catch (e) {
      toast.error(t("deleteAccountBtn.deleteFailed"));
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
          {t("deleteAccountBtn.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteAccountBtn.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteAccountBtn.confirmDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? <DumbbellLoader className="w-4 h-4" /> : t("common.deleteAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteAccountButton;
