import { supabase } from "@/integrations/supabase/client";
import { resizeImageToJpeg } from "@/lib/imageResize";

/**
 * お知らせの画像（2026-11-01・宗本さん「お知らせで画像を送れる様にして」）。
 *
 * ## 置き場所
 * 非公開バケット `announcement-images`。パスは `<tenant_id>/<uuid>.jpg`。
 * 読めるのは「そのジムのスタッフ」と「その画像が付いたお知らせを見られる人」だけ
 * （ストレージの RLS で縛っている。`supabase/migrations/20261101130000_announcement_images.sql`）。
 * 「個別」「全員から除く」で外れた人には、URL を知っていても見えない。
 *
 * ## ここの検査は「親切」であって「防御」ではない
 * 枚数・形・大きさは DB とバケットでも縛ってある。ここで止めるのは、上げてから断られる体験を避けるため。
 */

export const ANNOUNCEMENT_IMAGE_BUCKET = "announcement-images";

/** DB の announcements_image_paths_shape（_announcement_image_paths_ok）と同じ上限。片方だけ変えないこと。 */
export const MAX_ANNOUNCEMENT_IMAGES = 4;

/** 長い辺をこの幅に縮めた JPEG で上げる（チラシの文字が読める大きさ。バケットの上限 5MB に十分収まる） */
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.85;

/** input[type=file] の accept。iPhone の HEIC も JPEG にして渡ってくる。何が来ても JPEG に描き直してから上げる */
export const ANNOUNCEMENT_IMAGE_ACCEPT = "image/*";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** DB の _announcement_image_paths_ok と同じ形か（そのジムのフォルダの `<uuid>.jpg|png|webp`） */
export function isAnnouncementImagePath(path: string, tenantId: string): boolean {
  return new RegExp(`^${tenantId}/${UUID}\\.(jpg|png|webp)$`).test(path);
}

/** 新しい画像のパス（そのジムのフォルダ・推測できない名前） */
export function newAnnouncementImagePath(tenantId: string): string {
  return `${tenantId}/${crypto.randomUUID()}.jpg`;
}

export interface UploadedAnnouncementImage {
  path: string;
  /** 上げた画像をその場で見せるための URL（URL.createObjectURL。不要になったら revoke する） */
  previewUrl: string;
}

/** 画像を縮めて JPEG にし、そのジムのフォルダへ上げる。読めない画像（壊れている・対応していない形式）は投げる */
export async function uploadAnnouncementImage(file: File, tenantId: string): Promise<UploadedAnnouncementImage> {
  if (!file.type.startsWith("image/")) throw new Error("unsupported");
  const blob = await resizeImageToJpeg(file, MAX_WIDTH, JPEG_QUALITY);
  const path = newAnnouncementImagePath(tenantId);
  const { error } = await supabase.storage
    .from(ANNOUNCEMENT_IMAGE_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return { path, previewUrl: URL.createObjectURL(blob) };
}

/** 使わなくなった画像を片付ける。失敗は無視してよい（参照するお知らせが無ければ、お客様には見えない） */
export async function removeAnnouncementImages(paths: string[]): Promise<void> {
  const list = [...new Set(paths.filter(Boolean))];
  if (list.length === 0) return;
  try {
    await supabase.storage.from(ANNOUNCEMENT_IMAGE_BUCKET).remove(list);
  } catch {
    // 消せなくても実害は無い
  }
}

/** 署名つき URL の有効期間（お知らせを開いたまま置いておいても切れないくらい） */
export const ANNOUNCEMENT_IMAGE_URL_TTL_SECONDS = 60 * 60;

/** パスの配列から署名つき URL をまとめて作る（1枚ずつ呼ばない）。取れなかったものは入らない */
export async function signAnnouncementImageUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.storage
    .from(ANNOUNCEMENT_IMAGE_BUCKET)
    .createSignedUrls(unique, ANNOUNCEMENT_IMAGE_URL_TTL_SECONDS);
  const map = new Map<string, string>();
  (data ?? []).forEach((row, i) => {
    if (row?.signedUrl) map.set(unique[i], row.signedUrl);
  });
  return map;
}
