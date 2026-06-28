import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isNativePush, initPushForUser, detachNativeListeners } from "@/lib/pushNotifications";

// アプリ起動時のプッシュ初期化（設定画面に依存しない）。
// ログイン済み＆許可済みのユーザーについて、受信/タップ/トークン更新のリスナーを
// 登録し、この端末のトークンを保存し直す。これにより
//  - トークン更新の取りこぼし（再設定するまで通知が止まる）を防ぐ
//  - 端末ごとに正しく登録される（他端末の登録に引きずられない）
// 未許可ユーザーには何もしない（許可ダイアログは出さない）。
const PushBootstrap = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!isNativePush()) return;
    if (user) {
      initPushForUser(user.id);
    } else {
      detachNativeListeners();
    }
  }, [user]);

  return null;
};

export default PushBootstrap;
