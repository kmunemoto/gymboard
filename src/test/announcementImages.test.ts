/**
 * お知らせの画像（2026-11-01）。宗本さん「お知らせで画像を送れる様にして」。
 *
 * 🔴 壊しやすいもの:
 *   1. 置き場を公開にする／URL をそのまま保存する → URL を知っていれば、届いていない人・ジムの外の人でも見られる
 *   2. 読める人を「ジムの在籍者」にする → 「個別」「全員から除く」で外した人にも見える（お知らせの読み取り権限に揃える）
 *   3. 古いアプリから保存すると画像が消える（引数を送らない＝画像はそのまま、にする）
 *   4. 枚数・形の上限が画面と DB で食い違う
 *   5. 以前の image_url / image_url2（外のサイトの URL を <img> に入れる）が生き返る
 *
 * 画面の動き（上げる・外す・保存・片付け）は announcementImagesUi.test.tsx。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const m = vi.hoisted(() => ({
  buckets: [] as string[],
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrls: vi.fn(),
  resize: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        m.buckets.push(bucket);
        return { upload: m.upload, remove: m.remove, createSignedUrls: m.createSignedUrls };
      },
    },
  },
}));
vi.mock("@/lib/imageResize", () => ({ resizeImageToJpeg: (...a: unknown[]) => m.resize(...a) }));

import {
  ANNOUNCEMENT_IMAGE_BUCKET,
  ANNOUNCEMENT_IMAGE_URL_TTL_SECONDS,
  MAX_ANNOUNCEMENT_IMAGES,
  isAnnouncementImagePath,
  newAnnouncementImagePath,
  removeAnnouncementImages,
  signAnnouncementImageUrls,
  uploadAnnouncementImage,
} from "@/lib/announcementImages";

// 架空の ID（実在のジムではない）
const T = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const U1 = "00000000-0000-4000-8000-000000000001";

const SQL_RAW = readFileSync("supabase/migrations/20261101130000_announcement_images.sql", "utf8");
const SQL = SQL_RAW.replace(/--[^\n]*/g, "");
const policy = (name: string) => {
  const i = SQL.indexOf(`CREATE POLICY "${name}"`);
  expect(i, name).toBeGreaterThan(-1);
  return SQL.slice(i, SQL.indexOf(");\n", i) + 2);
};

beforeEach(() => {
  m.buckets.length = 0;
  m.upload.mockReset().mockResolvedValue({ data: { path: "x" }, error: null });
  m.remove.mockReset().mockResolvedValue({ data: [], error: null });
  m.createSignedUrls.mockReset();
  m.resize.mockReset().mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
});

describe("置き場のパス（src/lib/announcementImages.ts）", () => {
  it("そのジムのフォルダの <uuid>.jpg|png|webp だけ", () => {
    expect(isAnnouncementImagePath(`${T}/${U1}.jpg`, T)).toBe(true);
    expect(isAnnouncementImagePath(`${T}/${U1}.png`, T)).toBe(true);
    expect(isAnnouncementImagePath(`${T}/${U1}.webp`, T)).toBe(true);
    // 他のジムのフォルダ・下の階層・上の階層・別の形式・フォルダ無し
    expect(isAnnouncementImagePath(`${OTHER}/${U1}.jpg`, T)).toBe(false);
    expect(isAnnouncementImagePath(`${T}/x/${U1}.jpg`, T)).toBe(false);
    expect(isAnnouncementImagePath(`${T}/../${OTHER}/${U1}.jpg`, T)).toBe(false);
    expect(isAnnouncementImagePath(`${T}/${U1}.gif`, T)).toBe(false);
    expect(isAnnouncementImagePath(`${T}/${U1}.jpg.html`, T)).toBe(false);
    expect(isAnnouncementImagePath(`${U1}.jpg`, T)).toBe(false);
    // 大文字の16進（DB の正規表現は小文字だけ。crypto.randomUUID も小文字）
    expect(isAnnouncementImagePath(`${T}/0000000A-0000-4000-8000-00000000000C.jpg`, T)).toBe(false);
  });

  it("新しいパスは推測できない名前で、そのジムのフォルダに作る", () => {
    const a = newAnnouncementImagePath(T);
    const b = newAnnouncementImagePath(T);
    expect(isAnnouncementImagePath(a, T)).toBe(true);
    expect(a.endsWith(".jpg")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("🔴 画面と DB で同じ上限・同じ形（片方だけ変えない）", () => {
  const okFn = SQL.slice(SQL.indexOf("FUNCTION public._announcement_image_paths_ok"), SQL.indexOf("$function$;"));

  it("枚数の上限", () => {
    expect(okFn).toContain(`cardinality(p_paths) > ${MAX_ANNOUNCEMENT_IMAGES}`);
  });

  it("パスの形: DB の正規表現と画面の判定が同じ答えを出す", () => {
    const m1 = okFn.match(/p_tenant::text \|\| '([^']+)'/);
    expect(m1).not.toBeNull();
    const dbRe = new RegExp(`^${T}${m1![1]}`);
    const ins = policy("announcement images: owners can upload").match(/WHEN name !~ '([^']+)' THEN false/);
    expect(ins).not.toBeNull();
    const insRe = new RegExp(ins![1]);
    const samples = [
      `${T}/${U1}.jpg`, `${T}/${U1}.png`, `${T}/${U1}.webp`, `${T}/${U1}.gif`, `${OTHER}/${U1}.jpg`,
      `${T}/x/${U1}.jpg`, `${T}/${U1}.jpg/x`, `${U1}.jpg`, `${T}/0000000A-0000-4000-8000-00000000000C.jpg`,
      `${T}/${newAnnouncementImagePath(T).split("/")[1]}`,
    ];
    for (const s of samples) {
      expect(dbRe.test(s), s).toBe(isAnnouncementImagePath(s, T));
      // 上げる時の形は「どこかのジムのフォルダ」（ジムが合っているかは権限で見る）
      if (s.startsWith(`${T}/`)) expect(insRe.test(s), s).toBe(isAnnouncementImagePath(s, T));
    }
  });
});

describe("アップロード", () => {
  it("画像を JPEG に描き直して、そのジムのフォルダへ上げる。上書きはしない", async () => {
    const file = new File(["png"], "flyer.png", { type: "image/png" });
    const res = await uploadAnnouncementImage(file, T);
    expect(m.resize).toHaveBeenCalledWith(file, 1600, 0.85);
    expect(m.buckets).toEqual([ANNOUNCEMENT_IMAGE_BUCKET]);
    expect(m.upload).toHaveBeenCalledTimes(1);
    const [path, blob, opts] = m.upload.mock.calls[0];
    expect(isAnnouncementImagePath(path, T)).toBe(true);
    expect((blob as Blob).type).toBe("image/jpeg");
    expect(opts).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(res).toEqual({ path, previewUrl: "blob:preview" });
  });

  it("画像でないファイルは上げない", async () => {
    await expect(uploadAnnouncementImage(new File(["%PDF"], "a.pdf", { type: "application/pdf" }), T)).rejects.toThrow();
    expect(m.upload).not.toHaveBeenCalled();
  });

  it("断られたら投げる（画面で「上げられませんでした」を出す）", async () => {
    m.upload.mockResolvedValue({ data: null, error: new Error("denied") });
    await expect(uploadAnnouncementImage(new File(["x"], "a.jpg", { type: "image/jpeg" }), T)).rejects.toThrow("denied");
  });
});

describe("表示用の URL・片付け", () => {
  it("署名つき URL は重複を除いて1回で取る。取れなかったものは入れない", async () => {
    const p1 = `${T}/${U1}.jpg`;
    const p2 = `${T}/${U1.replace(/1$/, "2")}.jpg`;
    m.createSignedUrls.mockResolvedValue({
      data: [{ path: p1, signedUrl: "https://signed/1", error: null }, { path: p2, signedUrl: null, error: "not found" }],
      error: null,
    });
    const urls = await signAnnouncementImageUrls([p1, p2, p1, ""]);
    expect(m.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(m.createSignedUrls).toHaveBeenCalledWith([p1, p2], ANNOUNCEMENT_IMAGE_URL_TTL_SECONDS);
    expect(urls.get(p1)).toBe("https://signed/1");
    expect(urls.has(p2)).toBe(false);
  });

  it("画像が無ければ取りに行かない", async () => {
    expect((await signAnnouncementImageUrls([])).size).toBe(0);
    expect(m.createSignedUrls).not.toHaveBeenCalled();
  });

  it("片付けは空なら呼ばない。失敗しても投げない（画面の操作を止めない）", async () => {
    await removeAnnouncementImages([]);
    expect(m.remove).not.toHaveBeenCalled();
    m.remove.mockRejectedValue(new Error("network"));
    await expect(removeAnnouncementImages([`${T}/${U1}.jpg`, `${T}/${U1}.jpg`])).resolves.toBeUndefined();
    expect(m.remove).toHaveBeenCalledWith([`${T}/${U1}.jpg`]);
  });
});

describe("DB（supabase/migrations/20261101130000_announcement_images.sql）", () => {
  it("🔴 置き場は非公開。5MB まで・JPEG / PNG / WebP だけ", () => {
    expect(SQL).toMatch(
      /VALUES \(\s*'announcement-images',\s*'announcement-images',\s*false,\s*5242880,\s*ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]\s*\)/,
    );
    expect(SQL).toMatch(/SET public\s+= EXCLUDED\.public/);
  });

  it("🔴 3つのポリシーとも、ログインした人だけ・まず他のバケットを外す（CASE で順番を決める）", () => {
    for (const name of [
      "announcement images: staff and recipients can read",
      "announcement images: owners can upload",
      "announcement images: owners can delete",
    ]) {
      const p = policy(name);
      expect(p, name).toContain("TO authenticated");
      expect(p, name).toMatch(/CASE\s+WHEN bucket_id <> 'announcement-images' THEN false/);
    }
  });

  it("🔴 読める人: そのジムのスタッフと、その画像が付いたお知らせを読める人（お知らせの読み取り権限をそのまま使う）", () => {
    const p = policy("announcement images: staff and recipients can read");
    expect(p).toContain("public.has_tenant_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner', 'trainer'])");
    expect(p).toMatch(
      /EXISTS \(\s*SELECT 1 FROM public\.announcements a\s+WHERE a\.tenant_id = \(\(storage\.foldername\(name\)\)\[1\]\)::uuid\s+AND storage\.objects\.name = ANY \(a\.image_paths\)\s*\)/,
    );
    // 配信対象・予約公開を自前で書き直さない（お知らせの RLS とずれる）。SECURITY DEFINER の抜け道も使わない
    expect(p).not.toMatch(/published_at|target|announcement_audience|is_tenant_member/);
  });

  it("🔴 上げる・消す: お知らせを作れる人だけ（インストラクター＝制限付きスタッフは不可）。上書きの口は作らない", () => {
    for (const name of ["announcement images: owners can upload", "announcement images: owners can delete"]) {
      const p = policy(name);
      expect(p, name).toContain("ARRAY['owner', 'trainer']");
      expect(p, name).toContain("AND NOT public.is_limited_staff(");
    }
    expect(SQL).not.toMatch(/FOR UPDATE/);
  });

  it("お知らせの行: 画像は4枚まで・そのジムのフォルダの決まった形。以前の image_url / image_url2 は常に空", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}'");
    expect(SQL).toMatch(/ADD CONSTRAINT announcements_image_paths_shape\s+CHECK \(public\._announcement_image_paths_ok\(image_paths, tenant_id\)\)/);
    expect(SQL).toMatch(/ADD CONSTRAINT announcements_legacy_image_urls_unused\s+CHECK \(image_url IS NULL AND image_url2 IS NULL\)/);
    expect(SQL).toMatch(/VALIDATE CONSTRAINT announcements_image_paths_shape/);
    expect(SQL).toMatch(/VALIDATE CONSTRAINT announcements_legacy_image_urls_unused/);
  });

  it("🔴 保存: 呼んだ人の権限のまま。画像を送らない（古いアプリ）なら画像はそのまま。前の版の決まりは残す", () => {
    const i = SQL.indexOf("CREATE FUNCTION public.save_announcement(");
    const fn = SQL.slice(i, SQL.indexOf("$function$;", SQL.indexOf("AS $function$", i)));
    expect(fn).toContain("SECURITY INVOKER");
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("p_image_paths text[] DEFAULT NULL::text[]");
    expect(fn).toContain("coalesce(p_image_paths, '{}'::text[])");
    expect(fn).toContain("image_paths = coalesce(p_image_paths, image_paths)");
    // 前の版（20261027020000）の決まり
    expect(fn).toContain("p_target NOT IN ('all', 'except', 'only')");
    expect(fn).toContain("audience_required");
    expect(fn).toContain("public.get_my_tenant_id()");
    expect(fn).toContain("NOT (user_id = ANY (v_ids))");
    expect(fn).toMatch(/INSERT INTO public\.announcements[\s\S]*INSERT INTO public\.announcement_audience/);
  });

  it("🔴 引数の違う同じ名前の関数を残さない（古いアプリの呼び出しがどちらか決められずに落ちる）。未ログインは呼べない", () => {
    expect(SQL).toContain(
      "DROP FUNCTION IF EXISTS public.save_announcement(text, text, text, text, timestamp with time zone, uuid[], uuid);",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.save_announcement(text, text, text, text, timestamp with time zone, uuid[], uuid, text[]) FROM PUBLIC, anon;",
    );
    expect(SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.save_announcement(text, text, text, text, timestamp with time zone, uuid[], uuid, text[]) TO authenticated, service_role;",
    );
    expect(SQL).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL_RAW).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

describe("画面のコード", () => {
  const dialog = readFileSync("src/components/customer/AnnouncementsDialog.tsx", "utf8");
  const lib = readFileSync("src/lib/announcementImages.ts", "utf8");

  it("🔴 お客様の画面は以前の image_url / image_url2 を出さない（外のサイトの画像を読み込ませない）", () => {
    expect(dialog).not.toMatch(/image_url/);
    expect(readFileSync("src/hooks/useAnnouncements.ts", "utf8")).not.toMatch(/image_url\??:/);
  });

  it("🔴 公開 URL は作らない。署名つきの URL だけ", () => {
    expect(dialog + lib).not.toContain("getPublicUrl");
    expect(dialog).toContain("signAnnouncementImageUrls(");
  });
});
