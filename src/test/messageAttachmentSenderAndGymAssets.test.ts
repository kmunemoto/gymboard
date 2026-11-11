/**
 * チャットの添付は「上げた本人が送ったメッセージ」の受信者だけが読める・ジムのロゴの書き込みからインストラクターを外す
 * （2026-11-11・定期点検 message-attachments-1・gym-assets-limited-staff-1）。
 *   `supabase/migrations/20261111040000_message_attachment_sender_and_gym_assets_owner.sql`
 *
 * 以前は、スタッフが自分宛てのメッセージを1行作って attachment_path にお客様の添付のパスを入れると、その写真・動画に
 * 署名付き URL を出せた（外されたあとでも、自分のジムを開けば同じ）。インストラクターは API でジムのロゴを差し替え・削除できた。
 * 本番で、お客様・オーナー・インストラクターを演じて確かめた（mem/ops/tenant-boundary.md 穴38）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const FILE = "20261111040000_message_attachment_sender_and_gym_assets_owner.sql";
const DIR = "supabase/migrations";
const norm = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").trim();
const SQL = norm(readFileSync(`${DIR}/${FILE}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** そのポリシーを最後に作ったマイグレーションと、その定義（CREATE POLICY 〜 次の ; まで） */
const latestPolicy = (name: string) => {
  const needle = `CREATE POLICY "${name}"`;
  const file = files.filter((f) => norm(readFileSync(`${DIR}/${f}`, "utf8")).includes(needle)).at(-1);
  const src = file ? norm(readFileSync(`${DIR}/${file}`, "utf8")) : "";
  const at = src.lastIndexOf(needle);
  // 本文に ; を含まない（CREATE POLICY 文は1文）
  return { file, body: at < 0 ? "" : src.slice(at, src.indexOf(";", at) + 1) };
};

describe("チャットの添付（message-attachments）", () => {
  const read = latestPolicy("message attachments: participants can read");

  it("読み取りのポリシーの最新の定義はこのマイグレーション", () => {
    expect(read.file).toBe(FILE);
  });

  it("送った本人はフォルダで読む（アップロード直後、参照する行がまだ無い瞬間のため）", () => {
    expect(read.body).toContain("bucket_id = 'message-attachments'");
    expect(read.body).toContain("auth.uid()::text = (storage.foldername(name))[1]");
  });

  it("🔴 受信者として読めるのは、送り主＝添付を上げた人（フォルダの持ち主）のメッセージだけ", () => {
    expect(read.body).toContain(
      "OR EXISTS ( SELECT 1 FROM public.messages m WHERE m.attachment_path = storage.objects.name AND m.receiver_id = auth.uid() AND m.sender_id::text = (storage.foldername(storage.objects.name))[1] )",
    );
  });

  it("「同じジムなら読める」「スタッフなら読める」にしていない", () => {
    for (const tooBroad of ["shares_tenant_with_me", "has_role", "is_tenant_member", "has_tenant_role"]) {
      expect(read.body.includes(tooBroad), tooBroad).toBe(false);
    }
  });

  it("🔴 添付のパスは「送り主のフォルダ/<uuid>.<拡張子>」だけ（CHECK・既存の行も確かめる）", () => {
    expect(SQL).toContain(
      "ALTER TABLE public.messages ADD CONSTRAINT messages_attachment_path_shape CHECK ( attachment_path IS NULL OR attachment_path ~ ( '^' || (sender_id)::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp|mp4|mov)$' ) ) NOT VALID;",
    );
    expect(SQL).toContain("ALTER TABLE public.messages VALIDATE CONSTRAINT messages_attachment_path_shape;");
  });

  it("アプリが作るパス（どの拡張子でも）は CHECK に合う・ほかの人のフォルダは合わない", () => {
    const lib = readFileSync("src/lib/messageAttachment.ts", "utf8");
    const ext = lib.slice(lib.indexOf("const extensionOf"), lib.indexOf("};", lib.indexOf("const extensionOf")));
    const exts = [...ext.matchAll(/return "(\w+)";/g)].map((m) => m[1]).sort();
    expect(exts).toEqual(["jpg", "mov", "mp4", "png", "webp"]);
    expect(lib).toContain("const path = `${senderId}/${crypto.randomUUID()}.${extensionOf(contentType)}`;");

    const tail = /'\/(\[0-9a-f\][^']*)'/.exec(SQL)![1];
    const sender = "7f1c2b3a-0000-4000-8000-0123456789ab";
    const shape = new RegExp(`^${sender}/${tail}`);
    for (const e of exts) expect(shape.test(`${sender}/${crypto.randomUUID()}.${e}`), e).toBe(true);
    expect(shape.test(`00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}.jpg`)).toBe(false);
    expect(shape.test(`${sender}/${crypto.randomUUID()}.gif`)).toBe(false);
    expect(shape.test(`${sender}/../x/${crypto.randomUUID()}.jpg`)).toBe(false);
  });
});

describe("ジムの画像（gym-assets）", () => {
  const WRITES = ["Trainers can upload gym assets", "Trainers can update gym assets", "Trainers can delete gym assets"];

  it("🔴 書き込み・差し替え・削除の3本は、インストラクター（制限付きスタッフ）を外す", () => {
    for (const name of WRITES) {
      const p = latestPolicy(name);
      expect(p.file, name).toBe(FILE);
      expect(p.body, name).toContain("bucket_id = 'gym-assets'");
      expect(p.body, name).toContain("public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])");
      expect(p.body, name).toContain("(storage.foldername(name))[1] = (public.get_my_tenant_id())::text");
      expect(p.body, name).toContain("AND NOT public.is_limited_staff(public.get_my_tenant_id(), auth.uid())");
    }
  });

  it("一覧（SELECT）はこのマイグレーションで変えていない", () => {
    expect(SQL).not.toContain("Gym staff can list own gym assets");
  });

  it("ロゴを上げ下げする画面は、インストラクターには出さない（アプリの動きは変わらない）", () => {
    const view = readFileSync("src/components/trainer/TrainerView.tsx", "utf8");
    expect(view).toMatch(/shownTab === "gym-settings" && \(isLimitedStaff\s*\? <StaffAccountSettings[^>]*\/>\s*: <TrainerGymSettings/);
    const staff = readFileSync("src/components/trainer/StaffAccountSettings.tsx", "utf8");
    expect(staff).not.toContain("gym-assets");
  });
});
