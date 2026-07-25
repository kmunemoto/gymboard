import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// useTenant は26ファイルから呼ばれている。以前は呼び出しごとに独立した state を持って
// いたため、設定画面で refetch しても同時にマウントされている他のコンポーネントは
// 古い値のままだった。実際に「メニューのタブをOFFにしてもサイドバーから消えない
// （画面を開き直すまで反映されない）」という不具合が出ていた。
//
// ここでは「全ての利用箇所が同じ状態を共有すること」と、
// 「同時マウントで同じクエリを何本も投げないこと」を検証する。

let selectCalls = 0;
let gymName = "テストジム";
/** user_id → そのユーザーのジム名（テナント取り違えの検証用） */
const gymByUser: Record<string, string> = { u1: "ジムA", u2: "ジムB" };
let queriedUserId = "u1";

const makeQuery = () => {
  const result = () => ({
    data: {
      role: "owner",
      plan_id: null,
      tenants: {
        id: `t-${queriedUserId}`,
        gym_name: gymByUser[queriedUserId] ?? gymName,
        show_nav_messages: true,
      },
    },
    error: null,
  });
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  chain.select = () => chain;
  chain.eq = (col: string, value: unknown) => {
    // 実際のクエリと同じく user_id で絞り込む
    if (col === "user_id") queriedUserId = String(value);
    return chain;
  };
  for (const m of ["limit", "order"]) chain[m] = () => chain;
  chain.maybeSingle = () => chain;
  return chain;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "tenant_members") {
        selectCalls++;
        return makeQuery();
      }
      // tenant_plans
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
      return chain;
    },
  },
}));

const authUser = { current: { id: "u1" } as { id: string } | null };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: authUser.current, session: null, loading: false }),
}));

const { useTenant, __resetTenantStoreForTests } = await import("@/hooks/useTenant");

/** ジム名を表示するだけの購読者 */
const Viewer = ({ label }: { label: string }) => {
  const { tenant } = useTenant();
  return <span data-testid={label}>{tenant?.gym_name ?? "-"}</span>;
};

/** 設定画面のように refetch を呼ぶ側 */
const Editor = () => {
  const { refetch } = useTenant();
  return (
    <button
      onClick={() => {
        gymByUser.u1 = "変更後ジム";
        void refetch();
      }}
    >
      保存
    </button>
  );
};

beforeEach(() => {
  cleanup();
  selectCalls = 0;
  gymName = "テストジム";
  authUser.current = { id: "u1" };
  queriedUserId = "u1";
  // テスト間でジム名の書き換えが持ち越さないよう毎回戻す
  gymByUser.u1 = "ジムA";
  gymByUser.u2 = "ジムB";
  __resetTenantStoreForTests();
});
afterEach(() => cleanup());

describe("useTenant（テナント情報の共有）", () => {
  it("同時にマウントされた複数のコンポーネントが同じ値を見る", async () => {
    render(
      <>
        <Viewer label="a" />
        <Viewer label="b" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ジムA"));
    expect(screen.getByTestId("b").textContent).toBe("ジムA");
  });

  it("同時マウントでも tenant の取得は1回にまとまる", async () => {
    // 以前は利用箇所ぶん（1画面で数本）同じクエリが飛んでいた
    render(
      <>
        <Viewer label="a" />
        <Viewer label="b" />
        <Viewer label="c" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("c").textContent).toBe("ジムA"));
    expect(selectCalls).toBe(1);
  });

  it("片方が refetch すると、もう片方にも即座に反映される", async () => {
    // ここが落ちる = 設定を変えても他の画面が古いまま（メニューのタブが消えない等）
    render(
      <>
        <Viewer label="sidebar" />
        <Editor />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("sidebar").textContent).toBe("ジムA"));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByTestId("sidebar").textContent).toBe("変更後ジム"));
  });

  it("後からマウントされたコンポーネントは再取得せずキャッシュを使う", async () => {
    const first = render(<Viewer label="a" />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ジムA"));
    expect(selectCalls).toBe(1);

    first.rerender(
      <>
        <Viewer label="a" />
        <Viewer label="late" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("late").textContent).toBe("ジムA"));
    expect(selectCalls, "後発のマウントで再取得が走っている").toBe(1);
  });
});

// マルチテナントのため、別ジムの情報が一瞬でも見えるのは許容できない。
// キャッシュをモジュール単位で共有した以上、ユーザー切替とログアウトで
// 確実に切り離されることを検証する。
describe("useTenant（ユーザー切替時のテナント分離）", () => {
  it("別のユーザーに切り替わったら、前のユーザーのジムは絶対に見せない", async () => {
    const seen: string[] = [];
    const Recorder = () => {
      const { tenant } = useTenant();
      seen.push(tenant?.gym_name ?? "-");
      return <span data-testid="gym">{tenant?.gym_name ?? "-"}</span>;
    };

    const view = render(<Recorder />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムA"));

    // ここから先に描画された値だけを見る（切替前のジムAは当然含まれるため）
    seen.length = 0;

    // ログインユーザーが u2 に変わる（別のジムのオーナー）
    authUser.current = { id: "u2" };
    view.rerender(<Recorder />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムB"));

    // 切替後は一度たりともジムAを描画してはいけない。
    // useTenant はモジュール単位のキャッシュを共有しているため、ガードが無いと
    // 「u2 に切り替わったが useEffect がまだ走っていない」1レンダーで
    // 前のユーザーのジムがそのまま描画される。
    expect(seen, "ユーザー切替後にジムAが描画された").not.toContain("ジムA");
  });

  it("切替直後は loading=true になる（古い値を確定値として扱わない）", async () => {
    let snapshot: { gym: string | null; loading: boolean } = { gym: null, loading: true };
    const Probe = () => {
      const { tenant, loading } = useTenant();
      snapshot = { gym: tenant?.gym_name ?? null, loading };
      return null;
    };
    const view = render(<Probe />);
    await waitFor(() => expect(snapshot.loading).toBe(false));
    expect(snapshot.gym).toBe("ジムA");

    authUser.current = { id: "u2" };
    view.rerender(<Probe />);
    // 再取得が終わる前のこの時点で、ジムAが確定値として残っていてはいけない
    expect(snapshot.gym).not.toBe("ジムA");
    expect(snapshot.loading).toBe(true);
  });

  it("ログアウトするとテナント情報が消える", async () => {
    const Probe = () => {
      const { tenant, loading } = useTenant();
      return <span data-testid="gym">{loading ? "loading" : tenant?.gym_name ?? "-"}</span>;
    };
    const view = render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムA"));

    authUser.current = null;
    view.rerender(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("-"));
  });

  it("ログアウト→別ユーザーでログインしても前のジムは残らない", async () => {
    const Probe = () => {
      const { tenant } = useTenant();
      return <span data-testid="gym">{tenant?.gym_name ?? "-"}</span>;
    };
    const view = render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムA"));

    authUser.current = null;
    view.rerender(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("-"));

    authUser.current = { id: "u2" };
    view.rerender(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムB"));
  });

  it("refetch は常に今ログインしているユーザーぶんを取り直す", async () => {
    const Probe = () => {
      const { tenant, refetch } = useTenant();
      return (
        <>
          <span data-testid="gym">{tenant?.gym_name ?? "-"}</span>
          <button onClick={() => void refetch()}>再取得</button>
        </>
      );
    };
    const view = render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムA"));

    authUser.current = { id: "u2" };
    view.rerender(<Probe />);
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムB"));

    gymByUser.u2 = "ジムB（改名後）";
    fireEvent.click(screen.getByRole("button", { name: "再取得" }));
    await waitFor(() => expect(screen.getByTestId("gym").textContent).toBe("ジムB（改名後）"));
  });
});
