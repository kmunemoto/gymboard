import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  REACTION_KINDS,
  isReactionKind,
  summarize,
  groupByMessage,
  type Reaction,
} from "@/lib/messageReaction";

// リアクション（B4）。

const stripJs = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

const MIGRATION_DIR = "supabase/migrations";
const SQL = stripSql(
  readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${MIGRATION_DIR}/${f}`, "utf8"))
    .filter((s) => /message_reactions/.test(s))
    .join("\n"),
);

const r = (message_id: string, user_id: string, kind: Reaction["kind"]): Reaction => ({
  message_id,
  user_id,
  kind,
});

describe("まとめ方", () => {
  it("種別ごとに数え、自分が押しているかを持つ", () => {
    const s = summarize([r("m1", "a", "heart"), r("m1", "b", "heart"), r("m1", "b", "check")], "b");
    expect(s).toEqual([
      { kind: "heart", count: 2, mine: true },
      { kind: "check", count: 1, mine: true },
    ]);
  });

  it("押していない人の画面では mine が false", () => {
    expect(summarize([r("m1", "a", "heart")], "b")).toEqual([
      { kind: "heart", count: 1, mine: false },
    ]);
    // 未ログインでも落ちない
    expect(summarize([r("m1", "a", "heart")], null)[0].mine).toBe(false);
  });

  it("0件の種別は出さない（会話が記号だらけにならない）", () => {
    expect(summarize([], "a")).toEqual([]);
    expect(summarize([r("m1", "a", "heart")], "a")).toHaveLength(1);
  });

  it("🔴 並びは固定（件数順にしない）", () => {
    // 件数順にすると、誰かが押すたびにチップが入れ替わって押し間違える。
    const many = [
      r("m1", "a", "smile"),
      r("m1", "b", "smile"),
      r("m1", "c", "smile"),
      r("m1", "a", "thumbsUp"),
    ];
    expect(summarize(many, "a").map((s) => s.kind)).toEqual(["thumbsUp", "smile"]);
  });

  it("メッセージごとに配る", () => {
    const g = groupByMessage([r("m1", "a", "heart"), r("m2", "a", "check"), r("m1", "b", "heart")]);
    expect(g.get("m1")).toHaveLength(2);
    expect(g.get("m2")).toHaveLength(1);
    expect(g.get("m3")).toBeUndefined();
  });

  it("知らない種別を弾く", () => {
    expect(isReactionKind("heart")).toBe(true);
    expect(isReactionKind("poop")).toBe(false);
  });
});

describe("🔴 絵文字を使わない（リポジトリの規約）", () => {
  it("種別は Lucide アイコンのキー", () => {
    expect(REACTION_KINDS).toEqual(["thumbsUp", "heart", "check", "smile"]);
  });

  it("ライブラリにも UI にも絵文字が入っていない", () => {
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of [
      "src/lib/messageReaction.ts",
      "src/components/messages/MessageReactions.tsx",
    ]) {
      expect(EMOJI.test(readCode(f)), `${f} に絵文字が入っています`).toBe(false);
    }
  });

  it("アイコンは lucide-react から取っている", () => {
    const src = readCode("src/components/messages/MessageReactions.tsx");
    expect(src).toMatch(/from "lucide-react"/);
    // 4種すべてに割り当てがあること
    for (const k of REACTION_KINDS) {
      expect(src, `${k} のアイコン割り当てがありません`).toMatch(new RegExp(`${k}:`));
    }
  });
});

describe("DB 側の守り", () => {
  it("テーブルとテナント分離がある", () => {
    expect(SQL, "テーブルがありません").toMatch(/CREATE TABLE IF NOT EXISTS public\.message_reactions/);
    expect(SQL, "RLS を有効にしていません").toMatch(
      /ALTER TABLE public\.message_reactions ENABLE ROW LEVEL SECURITY/,
    );
    expect(SQL, "RESTRICTIVE なテナント分離がありません").toMatch(
      /CREATE POLICY tenant_isolation ON public\.message_reactions AS RESTRICTIVE/,
    );
  });

  it("🔴 見える範囲を messages に乗せている（独自条件を書かない）", () => {
    // ここに独自の条件を書くと、messages 側を直したときに食い違う。
    const idx = SQL.indexOf("CREATE POLICY message_reactions_select");
    expect(idx).toBeGreaterThan(-1);
    const body = SQL.slice(idx, idx + 600);
    expect(body, "messages を参照していません").toMatch(/FROM public\.messages m/);
    expect(body, "当事者に絞っていません").toMatch(/m\.sender_id[\s\S]{0,120}m\.receiver_id/);
    // 🔴 「同じテナントなら見える」に緩めない
    expect(
      /shares_tenant_with_me/.test(body),
      "同じジムなら見える、に緩めています。別のお客様が他人の会話のリアクションを読めます。",
    ).toBe(false);
  });

  it("🔴 他人の名前で付けられない", () => {
    const idx = SQL.indexOf("CREATE POLICY message_reactions_insert");
    expect(idx).toBeGreaterThan(-1);
    expect(SQL.slice(idx, idx + 600), "user_id を検査していません").toMatch(
      /auth\.uid\(\) = user_id/,
    );
  });

  it("🔴 外せるのは自分の分だけ（trainer でも他人のは消せない）", () => {
    // has_role(trainer) はテナント横断のグローバルロール。
    const idx = SQL.indexOf("CREATE POLICY message_reactions_delete");
    expect(idx).toBeGreaterThan(-1);
    const body = SQL.slice(idx, idx + 300);
    expect(body).toMatch(/auth\.uid\(\) = user_id/);
    expect(
      /has_role/.test(body),
      "trainer が他人のリアクションを消せます",
    ).toBe(false);
  });

  it("同じ種別を二重に付けられない／未知の種別を弾く", () => {
    expect(SQL).toMatch(/UNIQUE \(message_id, user_id, kind\)/);
    expect(SQL).toMatch(/CHECK \(kind IN \('thumbsUp', 'heart', 'check', 'smile'\)\)/);
  });

  it("UPDATE の権限を渡さない（種別だけ書き換える経路を作らない）", () => {
    expect(SQL).toMatch(/REVOKE UPDATE ON public\.message_reactions FROM authenticated, anon/);
  });
});

describe("🔴 リアクションで通知を鳴らさない", () => {
  it("messages のトリガーに巻き込まれていない", () => {
    // 気軽に押せることが価値。押すたびに相手の携帯が鳴ると押せなくなる。
    expect(
      /AFTER INSERT ON public\.message_reactions/.test(SQL),
      "message_reactions に通知トリガーが付いています",
    ).toBe(false);
    expect(
      /notify_new_message[\s\S]{0,200}message_reactions/.test(SQL),
      "通知の経路にリアクションが混ざっています",
    ).toBe(false);
  });

  it("クライアントからも通知を投げていない", () => {
    const hook = readCode("src/hooks/useMessageReactions.ts");
    expect(/send-push-notification/.test(hook), "リアクションでプッシュを送っています").toBe(false);
  });
});

describe("取り消したメッセージには付けられない", () => {
  it("両方の画面で、取り消し済みならピッカーもチップも出さない", () => {
    for (const f of [
      "src/components/trainer/TrainerMessages.tsx",
      "src/components/customer/CustomerChat.tsx",
    ]) {
      const src = readCode(f);
      expect(src, `${f}: 取り消し済みでもリアクションを付けられます`).toMatch(
        /onReact=\{\s*unsent \? undefined :/,
      );
      expect(src, `${f}: 取り消し済みでもチップが出ます`).toMatch(
        /\{!unsent && \(\s*<MessageReactions/,
      );
    }
  });
});

describe("N+1 にしない", () => {
  it("会話のメッセージ id をまとめて1回で引く", () => {
    const hook = readCode("src/hooks/useMessageReactions.ts");
    expect(hook, "まとめて引いていません").toMatch(/\.in\("message_id", ids\)/);
  });
});
