import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { upstreamOnly } from "./helpers/upstream";

// 兄弟アプリ（業種特化フォーク）が「自社ジムの tenant UUID を null にして無効化する」
// ときの安全性を見張るテスト。
//
// 背景（2026-08-01・ストレッチボードの上流取り込みで実際に踏んだ罠）:
//   LEGACY_DEFAULT_TENANT_ID / DROP_IN_TENANT_ID を null にすると、
//   `tenantId === DEFAULT_TENANT_ID` のような素朴な比較が **null === null で true** になる。
//   結果、「無効化したつもりが、テナントID無しのURLでだけ有効になる」という
//   **逆の挙動**が生まれる。エラーも警告も出ないので気づけない。
//
// 上流側を null 安全にしておけば、フォークは値を null にするだけで済む
// （mem/ops/vertical-fork.md 鉄則1「業種差分は値にする。コードの形を変えない」）。

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/dropInTenant");
});

describe("isDropInAvailable の null 安全性", () => {
  it("どの構成でも、無関係なID・null・undefined は false", async () => {
    // フォーク（DROP_IN_TENANT_ID=null）でも成り立つ不変条件だけをここで見る
    const { isDropInAvailable } = await import("@/lib/dropInTenant");
    expect(isDropInAvailable("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isDropInAvailable(null)).toBe(false);
    expect(isDropInAvailable(undefined)).toBe(false);
  });

  it("DROP_IN_TENANT_ID=null（兄弟アプリ）では、null を渡しても false", async () => {
    // ここが本題。素朴に `tenantId === DROP_IN_TENANT_ID` と書くと true になり、
    // /drop-in（テナントID無し）でだけドロップイン予約が有効になってしまう。
    vi.doMock("@/lib/dropInTenant", async (orig) => {
      const actual = await orig<typeof import("@/lib/dropInTenant")>();
      const DROP_IN_TENANT_ID: string | null = null;
      return {
        ...actual,
        DROP_IN_TENANT_ID,
        isDropInAvailable: (tenantId: string | null | undefined) =>
          !!DROP_IN_TENANT_ID && tenantId === DROP_IN_TENANT_ID,
      };
    });
    const { isDropInAvailable } = await import("@/lib/dropInTenant");
    expect(isDropInAvailable(null)).toBe(false);
    expect(isDropInAvailable(undefined)).toBe(false);
    expect(isDropInAvailable("ceda19b0-d5e0-4928-ab2e-996a0b823af4")).toBe(false);
  });

  it("実装が `!!DROP_IN_TENANT_ID &&` のガードを持っている", () => {
    // 上のテストはモックなので、実装そのものにガードがあることを別途確認する
    // （モックだけだと、実装からガードを消してもテストが通ってしまう）。
    const src = readFileSync("src/lib/dropInTenant.ts", "utf8");
    expect(src).toMatch(/!!DROP_IN_TENANT_ID\s*&&/);
  });
});

describe("既定テナントを null にできる形になっている", () => {
  it("LEGACY_DEFAULT_TENANT_ID の型が string | null（フォークが値だけ変えられる）", () => {
    const src = readFileSync("src/lib/legacyDefaultTenant.ts", "utf8");
    expect(src).toMatch(/LEGACY_DEFAULT_TENANT_ID:\s*string \| null/);
  });

  it("TrialBooking の見出しがテナントで分岐していない", () => {
    // ── この検査が変わった経緯（2026-08-08）────────────────────────
    // 元は `DEFAULT_TENANT_ID !== null && effectiveTenantId === DEFAULT_TENANT_ID`
    // というガードの存在を断言していた。複製元ジム専用の見出し（「初回無料体験」）が、
    // 既定テナントを持たないフォークで **null === null が成立して全テナントに出る**
    // のを防ぐためのもの。
    //
    // Salute御所南が体験を有料化したので、**その見出しの分岐ごと廃止した。**
    // 呼称は全ジム共通「体験トレーニング」（料金を語らない）で、金額は
    // tenants.trial_price_yen から出す。つまりガードが守っていた危険自体が消えた。
    //
    // ガードの存在を断言し続けると、**消したことで落ちる**（実際に落ちた）。
    // 代わりに「そもそも分岐が無い」という、より強い形を断言する。
    const src = readFileSync("src/pages/TrialBooking.tsx", "utf8");
    const headerLine = /const headerTitle\s*=([\s\S]*?);/.exec(src);
    expect(headerLine, "headerTitle の算出が見つからない").not.toBeNull();
    expect(
      headerLine![1],
      "見出しをテナントで分岐させています。既定テナントを持たないフォークでは " +
        "null === null が成立して、複製元ジム専用の文言が全テナントに出ます",
    ).not.toContain("DEFAULT_TENANT_ID");
  });

  it("公開ページはテナントIDが無いとき get_tenant_public を呼ばない", () => {
    // null を p_id に渡すと RPC がエラーを返すだけでなく、
    // 「無効なリンク」の案内を出す前に無駄な往復が入る。
    for (const path of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
      const src = readFileSync(path, "utf8");
      const idx = src.indexOf("const resolveId = tenantId || DEFAULT_TENANT_ID;");
      expect(idx, `${path} に resolveId の算出が見つからない`).toBeGreaterThan(-1);
      const after = src.slice(idx, idx + 200);
      expect(after, `${path} で resolveId の直後に null ガードが無い`).toMatch(
        /if \(!resolveId\) return;/,
      );
    }
  });
});

// 「ジムボード本体では、その1テナントだけ true」は上流の設定値そのものへの断言なので、
// DROP_IN_TENANT_ID を null にするフォークでは成り立たない。上流だけで見る。
upstreamOnly("ジムボード本体のドロップイン設定", () => {
  it("DROP_IN_TENANT_ID が設定されていて、そのテナントだけ true", async () => {
    const { isDropInAvailable, DROP_IN_TENANT_ID } = await import("@/lib/dropInTenant");
    expect(DROP_IN_TENANT_ID).toBeTruthy();
    expect(isDropInAvailable(DROP_IN_TENANT_ID)).toBe(true);
  });
});
