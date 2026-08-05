import { supabase } from "@/integrations/supabase/client";
import { LINE_INTEGRATION_ENABLED } from "@/lib/featureFlags";
import { devLog } from "@/lib/devLog";

/**
 * LINE（Messaging API）へのプッシュ送信の唯一の窓口。
 *
 * ## なぜ窓口を1つにするか
 * 以前は `supabase.functions.invoke("send-line-message", ...)` が10箇所に散っており、
 * `LINE_INTEGRATION_ENABLED` は**設定画面の表示しか止めていなかった**。
 * つまりフラグをOFFにしても、予約・キャンセル・メッセージのたびに送信は走り続ける。
 * ここを通す形にすることで、フラグ1つで確実に止まる。
 *
 * ## LINE連携を止めている理由（2026-07）
 * LINE Messaging API のトークン `LINE_CHANNEL_ACCESS_TOKEN` は**全テナント共有の1本**しか
 * 無い。ジムごとにLINE公式アカウントを持たせる仕組みが無いため:
 *   - 他ジムのお客様に、Salute のLINEアカウントから通知が飛ぶ形になる
 *   - `line-booking-reminder` は事故防止のため Salute テナントに限定されており、
 *     **他ジムにはLINEリマインドが一切届かない**（あるのに動かない機能）
 * マルチテナントSaaSとして配る以上、中途半端に残すより一旦外す判断。
 *
 * ## 「LINEで連絡」ボタン（tenants.line_url）は別物・残す
 * あちらは各ジムが自分のLINE URLを設定して、お客様に開いてもらうだけのリンク。
 * Messaging API もトークンも使わないので、マルチテナントでも問題なく動く。
 *
 * ## 復活させるには
 * `LINE_INTEGRATION_ENABLED` を true に戻すだけ。コードもDBのデータ
 * （profiles.line_user_id 等）も消していないので、そのまま元に戻る。
 * ただし本来は、ジムごとにチャネルアクセストークンを持てるようにしてからにすること。
 */

interface LineMessageBody {
  /**
   * 送信先の**Supabase の user_id**。
   *
   * ⚠️ かつて `userId`（LINE の userId を直接渡す）も受け付ける型になっていたが、
   * **Edge Function 側は `userId` を読んでいなかった**ので、そのまま渡しても
   * 宛先なし＝skip になるだけだった（`CustomerHome` の連続来店通知が該当。
   * エラーも出ないので誰も気づいていなかった）。
   *
   * 生の LINE ID 指定（`line_user_id`）は service_role 専用にしたため、
   * クライアントからは指定できない。**宛先は user_id で渡すこと。**
   */
  user_id: string;
  message: string;
}

/**
 * LINEへプッシュ送信する（無効時は何もしない）。
 * 送信失敗は握りつぶす — 通知が飛ばないことで予約処理自体を止めない。
 */
export async function sendLineMessage(body: LineMessageBody, context: string): Promise<void> {
  if (!LINE_INTEGRATION_ENABLED) {
    devLog(`[line] ${context}: LINE連携が無効なため送信しません`);
    return;
  }
  try {
    const res = await supabase.functions.invoke("send-line-message", { body });
    devLog(`[line] ${context}:`, res.error ? "error" : "ok", res.error ?? "");
  } catch (e) {
    console.error(`LINE通知に失敗（処理は継続）: ${context}`, e);
  }
}
