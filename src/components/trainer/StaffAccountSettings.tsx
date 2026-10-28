import { useTranslation } from "react-i18next";
import { LogOut, Lock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";

/**
 * インストラクター（制限付きスタッフ）の「アカウント」画面（2026-10-28・src/lib/staffAccess.ts）。
 *
 * 宗本さん「お店の設定とか触らせたくない」。インストラクターには店の設定（ジム設定）を出さず、
 * 設定タブの代わりにこの画面を出す。ログアウトとアカウントの削除だけができる
 * （設定タブを丸ごと消すと、ログアウトする場所が無くなる）。
 */
const StaffAccountSettings = ({ onSignOut }: { onSignOut: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant } = useTenant();

  return (
    <div className="space-y-4 pb-24 md:pb-0 max-w-lg" data-testid="staff-account-settings">
      <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
        <UserRound className="w-5 h-5 text-accent" />
        {t("staffAccount.title")}
      </h2>
      <Card>
        <CardContent className="p-4 space-y-1">
          <p className="text-sm font-bold break-words">{tenant?.gym_name}</p>
          {user?.email && <p className="text-xs text-muted-foreground break-all">{user.email}</p>}
          <p className="text-xs text-muted-foreground">{t("staff.roleInstructor")}</p>
        </CardContent>
      </Card>
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">{t("staffAccount.ownerOnly")}</p>
      </div>
      <Button
        variant="outline"
        className="w-full h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive font-bold"
        onClick={onSignOut}
      >
        <LogOut className="w-4 h-4 mr-2" />
        {t("settings.logout")}
      </Button>
      <DeleteAccountButton />
    </div>
  );
};

export default StaffAccountSettings;
