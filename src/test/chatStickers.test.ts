import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { STICKERS, findSticker } from "@/lib/stickers";

// チャットのスタンプ（LINE風）。2026-09-03 宗本さんの要望。
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. **知らないスタンプが届いても、文字として読めること。**
//     絵はアプリに同梱なので、送り手のほうが新しいと受け手には絵が無い。
//     このとき content（＝スタンプの文字）を吹き出しで出す。
//     2026-09-03 に「古いアプリが新しい規則を知らずに詰む」を実際に踏んだので、
//     最初から素直に落ちる形にしておく
//  2. **content を空にしないこと。** 空にすると通知の本文が空で飛び、
//     会話一覧のプレビューも空になり、検索にも掛からない
//  3. **スタンプを吹き出しに入れないこと。** 入れると「小さい添付写真」になる
//  4. **チャットの外枠の高さを触らないこと。** 外枠は --kb / --nav-h に依存していて、
//     ここは3回直している（mem/features/messaging.md）。スタンプ欄で4回目にしない
//  5. **絵が透過であること。** 白い四角のまま出ると、どの吹き出しの上でも浮く

const stripJs = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

const ASSET_DIR = "src/assets/stickers";
const LIB_SRC = readFileSync("src/lib/stickers.ts", "utf8");
const LIB = stripJs(LIB_SRC);
const SQL = stripSql(readFileSync("supabase/migrations/20260904010000_message_stickers.sql", "utf8"));
const HOOK = readCode("src/hooks/useMessages.ts");
const CUSTOMER = readCode("src/components/customer/CustomerChat.tsx");
const TRAINER = readCode("src/components/trainer/TrainerMessages.tsx");
const PICKER = readCode("src/components/messages/StickerPicker.tsx");
const BUBBLE = readCode("src/components/messages/MessageSticker.tsx");

const SCREENS: ReadonlyArray<[string, string]> = [
  ["お客様側", CUSTOMER],
  ["スタッフ側", TRAINER],
];

/** DB の CHECK と同じ形。ここを変えるならマイグレーションも変えること */
const ID_FORMAT = /^[a-z0-9_]{1,40}$/;

describe("スタンプの一覧", () => {
  it("空ではない（無いなら機能ごと消えているはず）", () => {
    expect(STICKERS.length).toBeGreaterThan(0);
  });

  it("🔴 id が DB の CHECK と同じ形（入れた瞬間に 23514 で落ちないこと）", () => {
    for (const s of STICKERS) expect(s.id, s.id).toMatch(ID_FORMAT);
  });

  it("マイグレーションの CHECK が、この形と同じものを書いている", () => {
    // 片方だけ緩めると「テストは通るのに本番で入らない」になる
    expect(SQL).toContain("sticker_id ~ '^[a-z0-9_]{1,40}$'");
  });

  it("id が重複していない（重複すると後ろの絵が永久に出ない）", () => {
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
  });

  it("🔴 text が空でない。これが本文として送られる", () => {
    // 空にすると通知の本文が空で飛び、一覧のプレビューも空になる
    for (const s of STICKERS) expect(s.text.trim(), s.id).not.toBe("");
  });

  it("絵が入っている", () => {
    for (const s of STICKERS) expect(s.src, s.id).toBeTruthy();
  });
});

describe("同梱した絵", () => {
  const files = readdirSync(ASSET_DIR).filter((f) => f.endsWith(".png")).sort();

  it("一覧とファイルが1対1（置き忘れ・書き忘れを止める）", () => {
    expect(files).toEqual(STICKERS.map((s) => `${s.id}.png`).sort());
  });

  it("全部 import されている（未使用のファイルが混ざっていない）", () => {
    for (const f of files) expect(LIB, f).toContain(`@/assets/stickers/${f}`);
  });

  for (const f of files) {
    it(`${f} が透過PNGで、512×512`, () => {
      const b = readFileSync(`${ASSET_DIR}/${f}`);
      expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNGの署名
      expect(b.readUInt32BE(16)).toBe(512);
      expect(b.readUInt32BE(20)).toBe(512);
      // 🔴 透過。パレット(3)なら tRNS、真の色(6)ならアルファ付き。
      //    白い四角のままだと、色の付いた吹き出しの上で四角く浮く。
      const colorType = b[25];
      const transparent = colorType === 6 || (colorType === 3 && b.includes(Buffer.from("tRNS")));
      expect(transparent, `${f} が透過ではありません（colorType=${colorType}）`).toBe(true);
    });
  }

  it("1枚あたりが重すぎない（アプリの大きさに直に効く）", () => {
    for (const f of files) {
      expect(statSync(`${ASSET_DIR}/${f}`).size, f).toBeLessThan(120 * 1024);
    }
  });
});

describe("知らない id の扱い", () => {
  it("一覧にある id は引ける", () => {
    for (const s of STICKERS) expect(findSticker(s.id)?.id).toBe(s.id);
  });

  it("🔴 知らない id は null（絵を出さず本文で見せるための入口）", () => {
    // 新しいスタンプを持つ端末から、まだ更新していない端末へ送られたとき。
    // ここで落ちると、会話が1件も開けなくなる。
    expect(findSticker("mada_shiranai_sutanpu")).toBeNull();
    expect(findSticker("")).toBeNull();
    expect(findSticker(null)).toBeNull();
    expect(findSticker(undefined)).toBeNull();
  });
});

describe("DB", () => {
  it("messages に sticker_id を足している", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.messages\s+ADD COLUMN IF NOT EXISTS sticker_id TEXT/);
  });

  it("🔴 送信取り消しでスタンプも落ちる", () => {
    // ここが無いと、取り消したのに絵だけ残る（本文だけ消えて絵が喋り続ける）
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.unsend_message"));
    expect(fn).toMatch(/UPDATE public\.messages[\s\S]*sticker_id\s*=\s*NULL/);
  });

  it("🔴 取り消しの他の中身を巻き戻していない（写し直しの事故を止める）", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.unsend_message"));
    // 送信者本人だけ・24時間以内・添付のパスを返す、はこの関数の要件そのもの
    expect(fn).toContain("auth.uid()");
    expect(fn).toContain("INTERVAL '24 hours'");
    expect(fn).toContain("attachment_path = NULL");
    expect(fn).toContain("unsent_at       = now()");
    expect(fn).toContain("RETURN v_path");
  });
});

describe("送信", () => {
  it("sendMessage が sticker_id を行に入れる", () => {
    expect(HOOK).toMatch(/sticker_id:\s*stickerId\s*\?\?\s*null/);
  });

  it("🔴 取り消したときに手元の行からもスタンプを消す", () => {
    // DB は落ちているのに画面だけ絵が残ると、消えたと思えない
    const unsend = HOOK.slice(HOOK.indexOf("const unsendMessage"));
    expect(unsend).toMatch(/sticker_id:\s*null/);
  });

  for (const [name, code] of SCREENS) {
    it(`${name}: 🔴 スタンプの文字を content として送っている`, () => {
      // sendMessage(sticker.text, 相手, null, sticker.id)
      // 第1引数を "" にすると、通知の本文が空で飛ぶ
      expect(code).toMatch(/sendMessage\(\s*sticker\.text\s*,[^)]*sticker\.id\s*,?\s*\)/);
    });

    it(`${name}: 選んだら送るところまで行く（もう一度「送信」を押させない）`, () => {
      expect(code).toContain("onPick={handleSendSticker}");
    });
  }
});

describe("画面の出し方", () => {
  for (const [name, code] of SCREENS) {
    it(`${name}: 知らない id なら絵を出さず、いつもの吹き出しに落ちる`, () => {
      expect(code).toContain("findSticker(msg.sticker_id)");
      expect(code).toMatch(/const sticker = unsent \? null : findSticker\(msg\.sticker_id\)/);
    });

    it(`${name}: 取り消し済みならスタンプを出さない`, () => {
      expect(code).toMatch(/unsent \? null : findSticker/);
    });

    it(`${name}: 🔴 スタンプを吹き出しに入れていない`, () => {
      // 吹き出し（rounded-2xl ... accent-gradient）は sticker が無いときの枝にだけ出る。
      // MessageSticker がその内側に入っていたら、ただの小さい添付写真になる。
      const branch = code.slice(code.indexOf("{sticker ? ("), code.indexOf(") : ("));
      expect(branch).toContain("<MessageSticker");
      expect(branch).not.toContain("accent-gradient");
      expect(branch).not.toContain("rounded-2xl px-");
    });

    it(`${name}: スタンプ欄と、それを開くボタンを出している`, () => {
      expect(code).toContain("<StickerPicker");
      expect(code).toContain("<StickerPickerButton");
    });
  }

  it("MessageSticker 自体が吹き出しの見た目を持っていない", () => {
    expect(BUBBLE).not.toContain("accent-gradient");
    expect(BUBBLE).not.toContain("border");
    expect(BUBBLE).toContain("object-contain");
  });

  it("絵に描いてある文字を読み上げに渡している", () => {
    expect(BUBBLE).toContain("alt={sticker.text}");
  });
});

describe("🔴 キーボードまわりを壊さない", () => {
  it("スタンプ欄が外枠の位置・高さに触っていない", () => {
    // 外枠は bottom-[max(var(--kb,0px),var(--nav-h,6rem))] で画面に貼ってある。
    // ここに fixed や --kb が現れたら、キーボードの計算が二重になる。
    expect(PICKER).not.toContain("--kb");
    expect(PICKER).not.toContain("--nav-h");
    expect(PICKER).not.toContain("fixed");
    expect(PICKER).not.toContain("absolute");
  });

  it("高さが固定（枚数で伸び縮みさせない）", () => {
    // 中身の枚数で伸びると、スタンプを1枚足した日に一覧の見え方が変わる
    expect(PICKER).toMatch(/h-\d+/);
  });

  for (const [name, code] of SCREENS) {
    it(`${name}: スタンプ欄を外枠の中で開いている`, () => {
      // 外枠の div より内側に置かれていること＝入力欄より前に現れること
      const picker = code.indexOf("{stickerOpen && ");
      const container = code.indexOf("bottom-[max(var(--kb,0px)");
      expect(container).toBeGreaterThanOrEqual(0);
      expect(picker).toBeGreaterThan(container);
    });
  }
});

describe("文言", () => {
  const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

  for (const lng of LOCALES) {
    it(`${lng} にスタンプの文言がある`, () => {
      const chat = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")).chat;
      expect(typeof chat.stickers).toBe("string");
      expect(chat.stickers.trim()).not.toBe("");
      expect(typeof chat.stickerHint).toBe("string");
      expect(chat.stickerHint.trim()).not.toBe("");
    });
  }

  it("スタンプ欄が i18n から引いている（リテラルで書いていない）", () => {
    expect(PICKER).toContain('t("chat.stickers")');
    expect(PICKER).toContain('t("chat.stickerHint")');
  });
});
