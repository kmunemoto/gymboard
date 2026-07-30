import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import Auth from "@/pages/Auth";
// Auth.tsx は @/lib/i18n を import していないので、ここで読み込まないと
// t() が生キー（"auth.modeLogin"）を返して日本語のアサーションが全滅する。
import "@/lib/i18n";

// 新規登録後の「確認メールを送信しました」がトーストで見落とされていた問題の回帰テスト。
//
// 以前は toast.success を出して setMode("login") でログイン画面に戻していた。
// 画面が「メール入力済み・パスワード空・アカウントにログイン」に化けるため
// 登録失敗と区別が付かず、画面最下部に8秒だけ出る小さなトーストも見落とされていた。
// 今はカードの中身をパネルに差し替える（パスワード再設定側と同じ作法）。

const signUp = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

const EMAIL = "tester@example.com";

const renderAuth = () =>
  render(
    <MemoryRouter>
      <Auth />
    </MemoryRouter>,
  );

/** 新規登録フォームを開いて送信する（既定の「お客様」タブのまま） */
const submitSignup = async () => {
  fireEvent.click(screen.getByText("アカウントをお持ちでない方はこちら"));
  fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
  fireEvent.change(screen.getByLabelText("パスワード（確認用）"), { target: { value: "abcdef12" } });
  fireEvent.click(screen.getByRole("button", { name: "アカウント作成" }));
};

beforeEach(() => {
  signUp.mockReset();
  signInWithPassword.mockReset();
});
afterEach(cleanup);

describe("確認メール送信後の画面", () => {
  it("トーストではなくカード内のパネルで案内する", async () => {
    // session が null = メール確認が必要な状態
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    renderAuth();
    await submitSignup();

    await waitFor(() => {
      expect(screen.getByText("確認メールを送信しました")).toBeTruthy();
    });
    // 宛先を出して「打ち間違えていないか」を自分で確認できるようにする
    expect(screen.getByText(EMAIL)).toBeTruthy();
    // 確認したあと何をすればいいかまで書く（メール本文のボタン名と一致させている）
    expect(screen.getByText(/メールアドレスを確認する/)).toBeTruthy();
    expect(screen.getByText(/迷惑メールフォルダ/)).toBeTruthy();
  });

  it("ログイン画面に戻さない（登録失敗に見える画面を作らない）", async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    renderAuth();
    await submitSignup();

    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());
    // 以前はここでログインフォームが出ていた
    expect(screen.queryByRole("button", { name: "ログイン" })).toBeNull();
    expect(screen.queryByLabelText("パスワード")).toBeNull();
    expect(screen.queryByText("アカウントにログイン")).toBeNull();
  });

  it("パネル表示中は出口が「ログインへ戻る」1本だけになる", async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());

    // タブ行を残すと1タップでパネルが消え、直したかった画面に戻ってしまう。
    // さらにタブを変えて登録し直すと user_metadata.role が上書きされる事故につながる。
    expect(screen.queryByText("お客様")).toBeNull();
    expect(screen.queryByText("ジムオーナー")).toBeNull();
    // 確認前のユーザーをログインへ誘導する2つ目の出口を作らない
    expect(screen.queryByText("すでにアカウントをお持ちの方はこちら")).toBeNull();
    // 送信後に「同意したものとみなされます」が残ると、まだ操作が要るように読める
    expect(screen.queryByText(/同意したものとみなされます/)).toBeNull();

    expect(screen.getByRole("button", { name: "ログインへ戻る" })).toBeTruthy();
  });

  it("「ログインへ戻る」でログインフォームに戻り、パネルが残らない", async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "ログインへ戻る" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
    });
    expect(screen.queryByText("確認メールを送信しました")).toBeNull();
  });

  it("スクリーンリーダーに届く（ライブリージョンとフォーカス移動）", async () => {
    // 押した送信ボタンが unmount されるため、フォーカスを移さないと
    // フォーカスが body に落ちて SR のカーソルが行方不明になる。
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    const { container } = renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());

    const live = container.querySelector('[role="status"][aria-live="polite"]');
    expect(live, "ライブリージョンが無い").toBeTruthy();
    expect(live!.textContent).toContain("確認メールを送信しました");
    // 操作（ボタン）はリージョンの外に出す。中に入れると読み上げ直してしまう。
    expect(live!.querySelector("button")).toBeNull();

    await waitFor(() => {
      expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    });
  });
});

describe("メール未確認のままログインを試したとき", () => {
  it("同じパネルを出す（同じ壁を2枚続けて踏ませない）", async () => {
    // 案内を見落としたユーザーの最も自然な次の行動。ここもトーストだと
    // 失敗理由まで同じ場所で見落とすことになる。
    signInWithPassword.mockResolvedValue({
      data: {}, error: new Error("Email not confirmed"),
    });
    renderAuth();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => {
      expect(screen.getByText("確認メールを送信しました")).toBeTruthy();
    });
    expect(screen.getByText(EMAIL)).toBeTruthy();
  });
});

describe("翻訳キーの5言語そろい（fallbackLng が ja なので欠けると日本語が出る）", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const authOf = (l: string) =>
    JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).auth as Record<string, string>;

  it("パネルで使うキーが全言語にある", () => {
    for (const key of ["signupSentTitle", "signupSentNext", "signupSentNative", "forgotSentNote", "backToLogin", "labelEmail"]) {
      for (const l of LANGS) {
        expect(authOf(l)[key], `${l}.json に auth.${key} が無い`).toBeTruthy();
      }
    }
  });

  it("auth 配下のキー集合が5言語で一致する", () => {
    // ja だけにキーを足すと、他言語のユーザーには日本語がそのまま出る
    // （src/lib/i18n.ts の fallbackLng: "ja"）。CI は緑のままなので気づけない。
    const base = Object.keys(authOf("ja")).sort();
    for (const l of LANGS.filter((x) => x !== "ja")) {
      const keys = Object.keys(authOf(l)).sort();
      const missing = base.filter((k) => !keys.includes(k));
      expect(missing, `${l}.json に足りない auth キー: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("日本語のまま他言語へコピーされていない", () => {
    for (const key of ["signupSentTitle", "signupSentNext", "signupSentNative"]) {
      const ja = authOf("ja")[key];
      for (const l of LANGS.filter((x) => x !== "ja")) {
        expect(authOf(l)[key], `${l}.json の auth.${key} が未翻訳`).not.toBe(ja);
      }
    }
  });
});
