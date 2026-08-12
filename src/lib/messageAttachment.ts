import { supabase } from "@/integrations/supabase/client";
import { resizeImageToJpeg } from "@/lib/imageResize";

/**
 * メッセージの添付（画像・動画）。
 *
 * ## 置き場所
 * 非公開バケット `message-attachments`。パスは `<sender_id>/<uuid>.<ext>`。
 * 読めるのは「送った本人」と「そのファイルを添付したメッセージの受信者」だけ
 * （ストレージの RLS で縛っている。`20260811020000_message_attachments.sql`）。
 *
 * ## ここの検査は「親切」であって「防御」ではない
 * 上限も形式も**バケット側にも設定してある**。ここで弾くのは、
 * 25MB を上げきってから怒られる、という体験を避けるためのもの。
 * ここを緩めてもサーバーが弾く。逆に**ここだけ厳しくしても意味は無い**。
 */

export const ATTACHMENT_BUCKET = "message-attachments";

/** バケット側の file_size_limit と同じ値。片方だけ変えないこと。 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** バケット側の allowed_mime_types と同じ集合。 */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;

/** input[type=file] の accept 属性。 */
export const ATTACHMENT_ACCEPT = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(",");

export type AttachmentType = "image" | "video";

export interface PreparedAttachment {
  path: string;
  type: AttachmentType;
}

/** MIME から種別を判定する。対象外なら null。 */
export function attachmentTypeOf(mime: string): AttachmentType | null {
  if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime)) return "image";
  if ((ALLOWED_VIDEO_TYPES as readonly string[]).includes(mime)) return "video";
  return null;
}

export type AttachmentRejection = "unsupported" | "too-large";

/**
 * 送る前の検査。問題なければ null、駄目なら理由を返す。
 *
 * ⚠️ 画像は後段でリサイズしてから上げるので、**元ファイルが上限を超えていても
 *    通す**。動画は変換できないのでそのまま判定する。
 */
export function rejectAttachment(file: File): AttachmentRejection | null {
  const type = attachmentTypeOf(file.type);
  if (!type) return "unsupported";
  if (type === "video" && file.size > MAX_ATTACHMENT_BYTES) return "too-large";
  return null;
}

/** バイト数を人が読める形に（エラー文言用）。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

const extensionOf = (mime: string): string => {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    default:
      return "jpg";
  }
};

/**
 * ファイルをアップロードして、messages に入れるパスと種別を返す。
 * 画像は 1200px の JPEG に落としてから上げる（進捗写真と同じ扱い）。
 */
export async function uploadAttachment(file: File, senderId: string): Promise<PreparedAttachment> {
  const type = attachmentTypeOf(file.type);
  if (!type) throw new Error("unsupported");

  let blob: Blob = file;
  let contentType = file.type;
  if (type === "image") {
    blob = await resizeImageToJpeg(file, 1200, 0.8);
    contentType = "image/jpeg";
  }

  const path = `${senderId}/${crypto.randomUUID()}.${extensionOf(contentType)}`;
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, blob, { contentType, upsert: false });
  if (error) throw error;

  return { path, type };
}

/** 送信をやめたときに、上げてしまったファイルを片付ける。失敗は無視してよい。 */
export async function discardAttachment(path: string): Promise<void> {
  try {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  } catch {
    // 消せなくても実害は無い（参照する行が無いので誰にも見えない）
  }
}

/** 署名URLの有効期間。開きっぱなしのタブでも切れないくらいの長さ。 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * パスの配列から署名URLをまとめて作る。取れなかったものは Map に入らない。
 * 1件ずつ createSignedUrl を呼ぶと添付の数だけ往復するので、必ずまとめて呼ぶこと。
 */
export async function signAttachmentUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  const map = new Map<string, string>();
  (data ?? []).forEach((row, i) => {
    if (row?.signedUrl) map.set(unique[i], row.signedUrl);
  });
  return map;
}
