import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { uniqueChannelName } from "@/lib/realtimeChannel";

// 2026-07-21 の本番障害（トレーナーのホームタブが丸ごとエラー表示）の回帰テスト。
// 詳細: mem/incidents/2026-07-21-home-tab-crash.md
//
// 原因は Realtime チャンネル名が固定だったこと。supabase.channel(name) は同名が
// あると **既存インスタンスを返す** ため、同じフックを1画面に2つマウントすると
// 2つ目の .on() が「購読済みチャンネルへの callbacks 追加」となって throw し、
// useEffect 内の例外が ErrorBoundary に伝播して画面全体が落ちた。
//
// 当時この障害は Playwright でも再現しなかった（サンドボックスは Supabase への
// WebSocket が繋がらず、チャンネルが joined にならないため throw しない）。
// ここでは supabase-js の該当挙動をモックで再現することで、実接続なしに検出する。

// --- supabase-js の「同名チャンネルは共有・購読後の .on() は throw」を再現するモック ---

const channelsByName = new Map<string, FakeChannel>();
const createdChannelNames: string[] = [];

class FakeChannel {
  subscribed = false;
  constructor(public name: string) {}
  on() {
    if (this.subscribed) {
      // realtime-js が実際に投げるのと同じ形の例外
      throw new Error(
        `cannot add \`postgres_changes\` callbacks for realtime:${this.name} after \`subscribe()\`.`,
      );
    }
    return this;
  }
  subscribe() {
    this.subscribed = true;
    return this;
  }
}

/** supabase.channel(name) 相当。同名は既存インスタンスを返す（ここが障害の肝） */
const fakeChannel = (name: string): FakeChannel => {
  createdChannelNames.push(name);
  const existing = channelsByName.get(name);
  if (existing) return existing;
  const created = new FakeChannel(name);
  channelsByName.set(name, created);
  return created;
};

/** from(...).select(...).order(...).in(...) を任意の順で繋げても空配列を返す thenable */
const emptyQuery = (): Record<string, unknown> => {
  const result = { data: [], error: null };
  const chain: Record<string, unknown> = {
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "order", "in", "eq", "gte", "lte", "limit", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  return chain;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => emptyQuery(),
    channel: (name: string) => fakeChannel(name),
    removeChannel: (ch: FakeChannel) => {
      // 実装同様に非同期（unsubscribe のネットワーク往復を待つ）。
      // 呼んだ直後は channels から外れないため、固定名だと再マウント時に衝突する。
      return Promise.resolve().then(() => {
        channelsByName.delete(ch.name);
      });
    },
  },
}));

// 本番の Context と同じく、参照が毎レンダー変わらないよう固定オブジェクトを返す
// （毎回新しいオブジェクトを返すと useCallback の依存が変わり、購読が張り直され続ける）
const FAKE_TENANT = { id: "t1", slot_duration_minutes: 60 };
const FAKE_AUTH = { user: { id: "u1" }, session: null, loading: false };

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: FAKE_TENANT, role: "owner", plans: [], loading: false, refetch: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => FAKE_AUTH,
}));

const { useAllBookings, useMyBookings } = await import("@/hooks/useBookings");

/** フックを呼ぶだけのコンポーネント（描画結果ではなく購読の副作用を見る） */
const AllBookingsConsumer = () => {
  useAllBookings();
  return null;
};
const MyBookingsConsumer = () => {
  useMyBookings();
  return null;
};

/** 作られたチャンネル名が1つも重複していないこと（＝共有インスタンス化が起きない） */
const expectAllNamesDistinct = () => {
  const dupes = createdChannelNames.filter((n, i) => createdChannelNames.indexOf(n) !== i);
  expect(dupes, `同じチャンネル名が再利用されました: ${[...new Set(dupes)].join(", ")}`).toEqual([]);
};

beforeEach(() => {
  channelsByName.clear();
  createdChannelNames.length = 0;
});
afterEach(() => cleanup());

describe("Realtime チャンネル名の衝突（2026-07-21 本番障害の回帰テスト）", () => {
  it("useAllBookings を同一画面に2つマウントしても落ちない", async () => {
    // 本番では TrainerDashboard 本体 + 稼働率ヒートマップがこの形になり、
    // 2つ目の .on() が throw して画面全体がエラー表示に落ちた。
    expect(() =>
      render(
        <>
          <AllBookingsConsumer />
          <AllBookingsConsumer />
        </>,
      ),
    ).not.toThrow();

    await waitFor(() => expect(createdChannelNames.length).toBeGreaterThanOrEqual(2));
    expectAllNamesDistinct();
  });

  it("useMyBookings を同一ユーザーで2つマウントしても落ちない", async () => {
    // お客様側の同型フック。user.id だけを名前にすると同じ衝突が起きる。
    expect(() =>
      render(
        <>
          <MyBookingsConsumer />
          <MyBookingsConsumer />
        </>,
      ),
    ).not.toThrow();

    await waitFor(() => expect(createdChannelNames.length).toBeGreaterThanOrEqual(2));
    expectAllNamesDistinct();
  });

  it("アンマウント直後に再マウントしても落ちない", async () => {
    // removeChannel は非同期。固定名だと旧チャンネルが joined のまま残っていて
    // 再購読の .on() が throw する（タブ切替で起きうる競合）。
    const first = render(<AllBookingsConsumer />);
    await waitFor(() => expect(createdChannelNames.length).toBe(1));
    first.unmount();
    expect(() => render(<AllBookingsConsumer />)).not.toThrow();
    await waitFor(() => expect(createdChannelNames.length).toBeGreaterThanOrEqual(2));
    expectAllNamesDistinct();
  });

  it("モックが本来の障害を再現できている（テスト自体の妥当性確認）", () => {
    // 固定名を使うと確かに throw することを確かめる。ここが throw しないなら
    // 上の3テストは「何も検証していない」ことになる。
    const a = fakeChannel("fixed-name").on();
    a.subscribe();
    expect(() => fakeChannel("fixed-name").on()).toThrowError(/after `subscribe\(\)`/);
  });
});

describe("Realtime チャンネル名の一意化ルール（静的チェック）", () => {
  it("uniqueChannelName は呼ぶたびに違う名前を返す", () => {
    const names = new Set(Array.from({ length: 200 }, () => uniqueChannelName("x")));
    expect(names.size).toBe(200);
    expect([...names][0]).toMatch(/^x-/);
  });

  it("src 配下の .channel() 呼び出しは全て uniqueChannelName を通している", () => {
    // 新しいフックが固定名で購読を足すと、その画面が2つ目のマウントで即クラッシュする。
    // 実行時に踏むまで気付けないので、ソース側で機械的に禁止する。
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file) || file.includes("/test/")) continue;
      if (file.endsWith("src/lib/realtimeChannel.ts")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.trim().startsWith("//")) return;
        if (!line.includes(".channel(")) return;
        if (line.includes("uniqueChannelName(")) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      offenders.length
        ? `固定名で Realtime チャンネルを作っています。uniqueChannelName() を通してください:\n${offenders.join("\n")}`
        : undefined,
    ).toEqual([]);
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
