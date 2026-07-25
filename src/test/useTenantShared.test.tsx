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

const makeQuery = () => {
  const result = () => ({
    data: {
      role: "owner",
      plan_id: null,
      tenants: { id: "t1", gym_name: gymName, show_nav_messages: true },
    },
    error: null,
  });
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  for (const m of ["select", "eq", "limit", "order"]) chain[m] = () => chain;
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: null, loading: false }),
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
        gymName = "変更後ジム";
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
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("テストジム"));
    expect(screen.getByTestId("b").textContent).toBe("テストジム");
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
    await waitFor(() => expect(screen.getByTestId("c").textContent).toBe("テストジム"));
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
    await waitFor(() => expect(screen.getByTestId("sidebar").textContent).toBe("テストジム"));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByTestId("sidebar").textContent).toBe("変更後ジム"));
  });

  it("後からマウントされたコンポーネントは再取得せずキャッシュを使う", async () => {
    const first = render(<Viewer label="a" />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("テストジム"));
    expect(selectCalls).toBe(1);

    first.rerender(
      <>
        <Viewer label="a" />
        <Viewer label="late" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("late").textContent).toBe("テストジム"));
    expect(selectCalls, "後発のマウントで再取得が走っている").toBe(1);
  });
});
