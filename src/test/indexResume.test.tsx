/**
 * アプリに戻るたびにホームへ戻っていた不具合の見張り（2026-09-24）。
 *
 * 宗本さん「予約画面を開いていて、他の所に飛んで帰ってきたらホームに戻る」
 * 「僕だけではなく、みんなこの現象になってます」。
 *
 * Supabase（auth-js）は画面が隠れた→見えたのたびにログインを確かめ直し、
 * 有効なら毎回 SIGNED_IN を通知する。AuthContext の `user` は**同じ人の新しい
 * オブジェクト**に差し替わる。Index がそれで所属を確かめ直すと、全画面の
 * 読み込み表示に切り替わって CustomerView / TrainerView が外れ、作り直され、
 * 開いていたタブが消えてホームに戻る。
 *
 * ここでは「同じ人の新しい user オブジェクト」を渡し直し、
 * 画面が外れない（作り直されない）ことを確かめる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type FakeAuth = {
  user: { id: string } | null;
  role: "customer" | "trainer" | null;
  loading: boolean;
};

let auth: FakeAuth = { user: null, role: null, loading: true };
const fromCalls: string[] = [];
let customerMounts = 0;
let trainerMounts = 0;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => auth,
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: table === "tenant_members" ? { id: "m1" } : null,
        error: null,
      }),
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        fromCalls.push(table);
        return query(table);
      },
    },
  };
});

vi.mock("@/components/customer/CustomerView", () => ({
  default: function FakeCustomerView() {
    useEffect(() => {
      customerMounts += 1;
    }, []);
    return <div data-testid="customer-view" />;
  },
}));

vi.mock("@/components/trainer/TrainerView", () => ({
  default: function FakeTrainerView() {
    useEffect(() => {
      trainerMounts += 1;
    }, []);
    return <div data-testid="trainer-view" />;
  },
}));

const { default: Index } = await import("@/pages/Index");

const tree = () => (
  <MemoryRouter>
    <Index />
  </MemoryRouter>
);

beforeEach(() => {
  auth = { user: null, role: null, loading: true };
  fromCalls.length = 0;
  customerMounts = 0;
  trainerMounts = 0;
});

describe("Index: アプリに戻っても画面を作り直さない", () => {
  it("お客様: 同じ人の新しい user オブジェクトが来ても、画面は外れず、所属も確かめ直さない", async () => {
    auth = { user: { id: "u1" }, role: "customer", loading: false };
    const { rerender } = render(tree());
    await screen.findByTestId("customer-view");
    expect(customerMounts).toBe(1);
    const checksBefore = fromCalls.length;

    // アプリに戻った: auth-js が SIGNED_IN を通知し、同じ人の新しいオブジェクトになる
    for (let i = 0; i < 3; i++) {
      auth = { ...auth, user: { id: "u1" } };
      rerender(tree());
      // 読み込み表示に切り替わっていない（同期的に見て、画面がそのまま在る）
      expect(screen.getByTestId("customer-view")).toBeInTheDocument();
    }
    await act(async () => {});

    expect(customerMounts).toBe(1);
    expect(fromCalls.length).toBe(checksBefore);
  });

  it("店: 同じく、戻っても画面が作り直されない", async () => {
    auth = { user: { id: "t1" }, role: "trainer", loading: false };
    const { rerender } = render(tree());
    await screen.findByTestId("trainer-view");

    auth = { ...auth, user: { id: "t1" } };
    rerender(tree());
    expect(screen.getByTestId("trainer-view")).toBeInTheDocument();
    await act(async () => {});

    expect(trainerMounts).toBe(1);
  });

  it("別の人に切り替わったら、所属を確かめ直す（前の人の結果を使い回さない）", async () => {
    auth = { user: { id: "u1" }, role: "customer", loading: false };
    const { rerender } = render(tree());
    await screen.findByTestId("customer-view");
    const checksBefore = fromCalls.length;

    auth = { user: { id: "u2" }, role: "customer", loading: false };
    rerender(tree());
    await waitFor(() => expect(fromCalls.length).toBeGreaterThan(checksBefore));
    await screen.findByTestId("customer-view");
  });
});

describe("Index: 依存の見張り（ソース）", () => {
  it("所属の確認は user.id で走らせる（user オブジェクトでは走らせない）", () => {
    const src = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8")
      // コメントの中の `[user]` に惑わされないよう、コメントを落としてから見る
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/\},\s*\[userId,\s*loading\]\s*\)/);
    expect(src).not.toMatch(/\[\s*user\s*,\s*loading\s*\]/);
  });
});
