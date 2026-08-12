import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ATTACHMENT_BUCKET,
  attachmentTypeOf,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  rejectAttachment,
} from "@/lib/messageAttachment";

// メッセージの添付（画像・動画）。
//
// パーソナルジムのチャットで一番やり取りしたいのはフォーム動画と食事写真で、
// そこだけ LINE に逃げていた。取り戻すのが目的。
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. **他人の会話の添付が読めないこと。** 会話の中身そのものなので、
//     「同じジムなら読める」では足りない
//  2. **上限と形式をサーバー側でも縛ること。** クライアントの検査だけだと、
//     直接 API を叩かれたときに何でも置ける置き場になる
//  3. **添付が黙って消えないこと。** 署名URLは DB の列ではないので、
//     素朴に書くと既読が立った瞬間に消える（実際に踏みかけた）

const MIGRATION = readFileSync(
  "supabase/migrations/20260811020000_message_attachments.sql",
  "utf8",
);
const LIB = readFileSync("src/lib/messageAttachment.ts", "utf8");
const HOOK = readFileSync("src/hooks/useMessages.ts", "utf8");
const PICKER = readFileSync("src/hooks/useAttachmentPicker.ts", "utf8");
const FUNC = readFileSync("supabase/functions/notify-new-message/index.ts", "utf8");
const CUSTOMER = readFileSync("src/components/customer/CustomerChat.tsx", "utf8");
const TRAINER = readFileSync("src/components/trainer/TrainerMessages.tsx", "utf8");

const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const stripJs = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const SQL = stripSql(MIGRATION);
const HOOK_CODE = stripJs(HOOK);
const FUNC_CODE = stripJs(FUNC);

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const localeJson = (lng: string) =>
  JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")) as Record<string, any>;

describe("添付の判定（クライアント側の親切）", () => {
  it("種別を MIME から判定する", () => {
    expect(attachmentTypeOf("image/jpeg")).toBe("image");
    expect(attachmentTypeOf("image/png")).toBe("image");
    expect(attachmentTypeOf("video/mp4")).toBe("video");
    expect(attachmentTypeOf("video/quicktime")).toBe("video");
    expect(attachmentTypeOf("application/pdf")).toBeNull();
    expect(attachmentTypeOf("")).toBeNull();
  });

  const file = (type: string, size: number) =>
    ({ type, size, name: "x" }) as unknown as File;

  it("対象外の形式は弾く", () => {
    expect(rejectAttachment(file("application/pdf", 100))).toBe("unsupported");
    expect(rejectAttachment(file("image/gif", 100))).toBe("unsupported");
  });

  it("大きすぎる動画は弾く", () => {
    expect(rejectAttachment(file("video/mp4", MAX_ATTACHMENT_BYTES + 1))).toBe("too-large");
    expect(rejectAttachment(file("video/mp4", MAX_ATTACHMENT_BYTES))).toBeNull();
  });

  it("🔴 大きい画像は弾かない（リサイズしてから上げるので）", () => {
    // ここを動画と同じ扱いにすると、最近のスマホで撮った写真がほぼ全部弾かれる。
    expect(rejectAttachment(file("image/jpeg", MAX_ATTACHMENT_BYTES * 3))).toBeNull();
  });

  it("上限の文言が人に読める形になる", () => {
    expect(formatBytes(25 * 1024 * 1024)).toBe("25MB");
    expect(formatBytes(500 * 1024)).toBe("500KB");
    expect(formatBytes(10)).toBe("1KB");
  });
});

describe("🔴 他人の会話の添付が読めないこと", () => {
  it("バケットは非公開", () => {
    expect(SQL).toMatch(new RegExp(`'${ATTACHMENT_BUCKET}'`));
    expect(SQL, "バケットが public になっています").toMatch(
      /INSERT INTO storage\.buckets[\s\S]{0,300}false,/,
    );
  });

  it("読めるのは「送信者」と「そのファイルを添付したメッセージの受信者」だけ", () => {
    const idx = SQL.indexOf("message attachments: participants can read");
    expect(idx, "SELECT ポリシーがありません").toBeGreaterThan(-1);
    const policy = SQL.slice(idx, idx + 900);
    // 送信者はフォルダ所有で読む（アップロード直後、参照する行がまだ無い瞬間のため）
    expect(policy).toMatch(/auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
    // 受信者は「その添付を参照する行がある」ことで読む
    expect(policy, "受信者の判定がメッセージ行と結びついていません").toMatch(
      /EXISTS[\s\S]{0,200}public\.messages[\s\S]{0,200}attachment_path = storage\.objects\.name[\s\S]{0,120}receiver_id = auth\.uid\(\)/,
    );
  });

  it("🔴 「同じテナントなら読める」にしていない", () => {
    // それだと**同じジムの別のお客様**が他人の会話の添付を読める。
    // パスが推測困難なだけ、という状態になる。
    const idx = SQL.indexOf("message attachments: participants can read");
    const policy = SQL.slice(idx, idx + 900);
    for (const tooBroad of ["shares_tenant_with_me", "has_role", "is_tenant_member"]) {
      expect(
        policy.includes(tooBroad),
        `SELECT ポリシーが ${tooBroad} で広く許可しています。会話の当事者だけに絞ってください。`,
      ).toBe(false);
    }
  });

  it("アップロードと削除は本人のフォルダだけ", () => {
    for (const [label, marker] of [
      ["upload", "message attachments: sender can upload"],
      ["delete", "message attachments: sender can delete"],
    ] as const) {
      const idx = SQL.indexOf(marker);
      expect(idx, `${label} のポリシーがありません`).toBeGreaterThan(-1);
      expect(SQL.slice(idx, idx + 400)).toMatch(
        /auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/,
      );
    }
  });
});

describe("🔴 上限と形式はサーバー側でも縛る", () => {
  it("バケットに file_size_limit と allowed_mime_types がある", () => {
    expect(SQL, "サイズ上限がバケットに設定されていません").toMatch(/file_size_limit/);
    expect(SQL, "許可する形式がバケットに設定されていません").toMatch(/allowed_mime_types/);
  });

  it("クライアントの上限とバケットの上限が一致している", () => {
    // 片方だけ変えると「クライアントは通すのにサーバーが弾く（またはその逆）」になる。
    const m = SQL.match(/file_size_limit[\s\S]{0,200}?(\d{6,})/);
    expect(m, "バケットの上限値を読めません").toBeTruthy();
    expect(Number(m![1])).toBe(MAX_ATTACHMENT_BYTES);
  });

  it("クライアントの許可形式とバケットの許可形式が一致している", () => {
    const m = SQL.match(/allowed_mime_types[\s\S]*?ARRAY\[([^\]]+)\]/);
    expect(m, "バケットの許可形式を読めません").toBeTruthy();
    const bucketTypes = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    const clientTypes = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].slice().sort();
    expect(bucketTypes).toEqual(clientTypes);
  });
});

describe("行の整合性（DBの制約）", () => {
  it("パスと種別は必ずセット", () => {
    expect(SQL).toMatch(/CHECK \(\(attachment_path IS NULL\) = \(attachment_type IS NULL\)\)/);
  });

  it("種別は image / video のみ", () => {
    expect(SQL).toMatch(/attachment_type IN \('image', 'video'\)/);
  });

  it("🔴 本文も添付も無い行は作らせない", () => {
    expect(SQL, "空の行を止める制約がありません").toMatch(
      /CHECK \(btrim\(content\) <> ''+ OR attachment_path IS NOT NULL\)/,
    );
    // 既存行を検査すると適用が失敗しうる。NOT VALID にしてあること
    // （NOT VALID は「既存行を見ない」だけで、新しい行にはそのまま効く）。
    expect(SQL, "NOT VALID になっていません（適用時に既存行で落ちる恐れ）").toMatch(
      /attachment_path IS NOT NULL\) NOT VALID/,
    );
  });

  it("ストレージのポリシーが引く列に索引がある", () => {
    expect(SQL).toMatch(/CREATE INDEX[\s\S]{0,120}messages \(attachment_path\)/);
  });
});

describe("🔴 添付が黙って消えないこと", () => {
  it("既読が立っても添付URLを消さない", () => {
    // attachment_url は DB の列ではないので Realtime の payload に無い。
    // 素直に上書きすると、相手が読んだ瞬間に添付が画面から消える。
    const idx = HOOK_CODE.indexOf('event: "UPDATE"');
    expect(idx).toBeGreaterThan(-1);
    expect(
      HOOK_CODE.slice(idx, idx + 700),
      "UPDATE のマージで attachment_url を維持していません",
    ).toMatch(/attachment_url: m\.attachment_url/);
  });

  it("署名URLをまとめて作っている（1件ずつ往復しない）", () => {
    expect(LIB, "まとめて署名するヘルパーがありません").toMatch(/createSignedUrls/);
    expect(
      /createSignedUrl\(/.test(LIB),
      "1件ずつ署名しています。添付の数だけ往復が増えます。",
    ).toBe(false);
  });

  it("送信をやめたら上げたファイルを片付ける", () => {
    // 片付けないと、誰からも見えないファイルだけがストレージに溜まる。
    expect(PICKER).toMatch(/discardAttachment/);
  });
});

describe("送信と表示", () => {
  it("🔴 アップロード中は送信させない", () => {
    // 行だけ先に入って添付が付かない状態を作らない。
    for (const [label, code] of [
      ["CustomerChat", CUSTOMER],
      ["TrainerMessages", TRAINER],
    ] as const) {
      expect(code, `${label} に送信可否の判定がありません`).toMatch(/const canSend =/);
      // ⚠️ 窓を広く取ると、下の handleSend にある `attachment.prepared` を拾ってしまい
      //    「添付だけの送信を禁じる」変異を見逃す（実際に素通りした）。
      //    canSend の**その1文だけ**を見る。
      const idx = code.indexOf("const canSend =");
      const stmt = code.slice(idx, code.indexOf(";", idx) + 1);
      expect(stmt.length, `${label} の canSend の文を切り出せません`).toBeGreaterThan(20);
      expect(stmt, `${label} がアップロード中でも送信できます`).toMatch(/!attachment\.uploading/);
      expect(stmt, `${label} が添付だけの送信を許していません`).toMatch(/attachment\.prepared/);
    }
  });

  it("両方の画面が添付を描画する", () => {
    for (const [label, code] of [
      ["CustomerChat", CUSTOMER],
      ["TrainerMessages", TRAINER],
    ] as const) {
      expect(code, `${label} が添付を表示していません`).toMatch(/<MessageAttachment/);
      expect(code, `${label} に添付ボタンがありません`).toMatch(/<AttachmentButton/);
    }
  });

  it("🔴 添付だけのとき、通知が空にならない", () => {
    // 本文が空のまま通知すると「何か届いたが何かは分からない」になる。
    expect(FUNC_CODE, "通知本文が添付の種別を見ていません").toMatch(
      /function preview\(text: string, attachmentType/,
    );
    const idx = FUNC_CODE.indexOf("function preview");
    const body = FUNC_CODE.slice(idx, idx + 600);
    expect(body, "本文が空のときの文言がありません").toMatch(/if \(!oneLine\)/);
    expect(FUNC_CODE, "通知が attachment_type を取得していません").toMatch(/attachment_type/);
  });

  it("会話一覧のプレビューが空欄にならない", () => {
    // 添付だけのメッセージはプレビューが空になり「メッセージなし」と区別できなくなる。
    expect(TRAINER).toMatch(/trainerMessages\.previewImage/);
    expect(TRAINER).toMatch(/trainerMessages\.previewVideo/);
  });
});

describe("5言語", () => {
  const KEYS = [
    "attach",
    "remove",
    "uploading",
    "readyImage",
    "readyVideo",
    "unavailable",
    "imageAlt",
    "errUnsupported",
    "errTooLarge",
    "errUploadFailed",
  ];

  it("messageAttachment が全言語に揃っている", () => {
    for (const lng of LOCALES) {
      const ns = localeJson(lng).messageAttachment;
      expect(ns, `${lng}.json に messageAttachment がありません`).toBeTruthy();
      for (const k of KEYS) {
        expect(typeof ns[k] === "string" && ns[k].length > 0, `${lng}.json の ${k} が空です`).toBe(
          true,
        );
      }
    }
  });

  it("上限の文言に {{max}} が入っている（数字を直書きしない）", () => {
    for (const lng of LOCALES) {
      expect(localeJson(lng).messageAttachment.errTooLarge, `${lng}`).toContain("{{max}}");
    }
  });

  it("会話プレビューの文言が全言語にある", () => {
    for (const lng of LOCALES) {
      const ns = localeJson(lng).trainerMessages;
      expect(typeof ns.previewImage).toBe("string");
      expect(typeof ns.previewVideo).toBe("string");
    }
  });
});
