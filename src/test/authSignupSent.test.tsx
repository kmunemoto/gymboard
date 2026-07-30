import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import Auth from "@/pages/Auth";
// Auth.tsx は @/lib/i18n を import していないので、ここで読み込まないと
// t() が生キー（"auth.modeLogin"）を返して日本語のアサーションが全滅する。
import "@/lib/i18n";

// 新規登録後の「確認メールを送信しました」がトーストで見落とされていた問題と、
// その周辺で見つかった一連の不具合の回帰テスト。
//
// 以前は toast.success を出して setMode("login") でログイン画面に戻していた。
// 画面が「メール入力済み・パスワード空・アカウントにログイン」に化けるため
// 登録失敗と区別が付かず、画面最下部に8秒だけ出る小さなトーストも見落とされていた。
// 今はカードの中身をパネルに差し替える（パスワード再設定側と同じ作法）。
// 加えて: エラー判定を error.code ベースに、確認リンク期限切れの表示、
// 既存ユーザーへの誤案内の修正、確認メール再送、ロール固定バグの案内を扱う。

const signUp = vi.fn();
const signInWithPassword = vi.fn();
const resend = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      resend: (...a: unknown[]) => resend(...a),
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

const EMAIL = "tester@example.com";

/** gotrue の実レスポンス形。新規の未確認ユーザーは identities.length === 1。 */
const newUnconfirmedUser = () => ({
  data: { session: null, user: { id: "u1", identities: [{ id: "id1", provider: "email" }] } },
  error: null,
});
/** Confirm email/phone が両方有効な環境で、既に確認済みの既存ユーザーに signUp したときの
 *  gotrue の偽装レスポンス。identities が空配列で返り、メールは1通も飛ばない。 */
const alreadyConfirmedFakeUser = () => ({
  data: { session: null, user: { id: "u1", identities: [] } },
  error: null,
});

const renderAuth = (initialPath = "/auth") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
      </Routes>
    </MemoryRouter>,
  );

/** 新規登録フォームを開いて送信する（既定の「お客様」タブのまま） */
const submitSignup = async (email = EMAIL) => {
  fireEvent.click(screen.getByText("アカウントをお持ちでない方はこちら"));
  fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
  fireEvent.change(screen.getByLabelText("パスワード（確認用）"), { target: { value: "abcdef12" } });
  fireEvent.click(screen.getByRole("button", { name: "アカウント作成" }));
};

/** ジムオーナータブに切り替えてから登録フォームを送信する */
const submitTrainerSignup = async (email = EMAIL) => {
  fireEvent.click(screen.getByText("ジムオーナー"));
  fireEvent.click(screen.getByText("ジムオーナーの方はこちらから新規登録"));
  fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
  fireEvent.change(screen.getByLabelText("パスワード（確認用）"), { target: { value: "abcdef12" } });
  fireEvent.click(screen.getByRole("button", { name: "アカウント作成" }));
};

beforeEach(() => {
  signUp.mockReset();
  signInWithPassword.mockReset();
  resend.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

describe("確認メール送信後の画面", () => {
  it("トーストではなくカード内のパネルで案内する", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
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
    signUp.mockResolvedValue(newUnconfirmedUser());
    renderAuth();
    await submitSignup();

    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());
    // 以前はここでログインフォームが出ていた
    expect(screen.queryByRole("button", { name: "ログイン" })).toBeNull();
    expect(screen.queryByLabelText("パスワード")).toBeNull();
    expect(screen.queryByText("アカウントにログイン")).toBeNull();
  });

  it("パネル表示中は出口が「ログインへ戻る」だけになる（再送ボタンを除く）", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
    renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());

    // タブ行を残すと1タップでパネルが消え、直したかった画面に戻ってしまう。
    expect(screen.queryByText("お客様")).toBeNull();
    expect(screen.queryByText("ジムオーナー")).toBeNull();
    // 確認前のユーザーをログインへ誘導する2つ目の出口を作らない
    expect(screen.queryByText("すでにアカウントをお持ちの方はこちら")).toBeNull();
    // 送信後に「同意したものとみなされます」が残ると、まだ操作が要るように読める
    expect(screen.queryByText(/同意したものとみなされます/)).toBeNull();

    expect(screen.getByRole("button", { name: "ログインへ戻る" })).toBeTruthy();
  });

  it("「ログインへ戻る」でログインフォームに戻り、パネルが残らない", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
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
    signUp.mockResolvedValue(newUnconfirmedUser());
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
  it("同じ骨格のパネルを、より正確な文言で出す（同じ壁を2枚続けて踏ませない）", async () => {
    // 案内を見落としたユーザーの最も自然な次の行動。ここもトーストだと
    // 失敗理由まで同じ場所で見落とすことになる。
    signInWithPassword.mockResolvedValue({
      data: {}, error: Object.assign(new Error("Email not confirmed"), { code: "email_not_confirmed" }),
    });
    renderAuth();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    // 「未確認」は「送信しました」と同じではない — ここでは何も送っていないので、
    // 断定形のタイトルを使わない。
    await waitFor(() => {
      expect(screen.getByText("メールアドレスの確認が済んでいません")).toBeTruthy();
    });
    expect(screen.queryByText("確認メールを送信しました")).toBeNull();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    // 再送導線はある
    expect(screen.getByRole("button", { name: /確認メールを再送する/ })).toBeTruthy();
  });

  it("message でしか code が取れない場合もフォールバックで拾う", async () => {
    // code を持たない環境（バージョン差・ネットワーク経由の別実装）を想定
    signInWithPassword.mockResolvedValue({
      data: {}, error: new Error("Email not confirmed"),
    });
    renderAuth();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => {
      expect(screen.getByText("メールアドレスの確認が済んでいません")).toBeTruthy();
    });
  });
});

describe("既に登録済みのメールアドレスで登録しようとしたとき", () => {
  it("identities が空配列（確認済み・偽装レスポンス）なら「確認メールを送信しました」と言わない", async () => {
    signUp.mockResolvedValue(alreadyConfirmedFakeUser());
    renderAuth();
    await submitSignup();

    await waitFor(() => {
      expect(screen.getByText("登録済みのメールアドレスです")).toBeTruthy();
    });
    expect(screen.queryByText("確認メールを送信しました")).toBeNull();
    // resend しても何も届かない（存在確認にしかならない）ので再送導線は出さない
    expect(screen.queryByRole("button", { name: /確認メールを再送する/ })).toBeNull();
    // ログイン以外にパスワード再設定へも行ける
    expect(screen.getByRole("button", { name: "パスワードを再設定する" })).toBeTruthy();
  });

  it("signUp が user_already_exists で例外を投げる場合も同じ案内", async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: Object.assign(new Error("User already registered"), { code: "user_already_exists" }),
    });
    renderAuth();
    await submitSignup();

    await waitFor(() => {
      expect(screen.getByText("登録済みのメールアドレスです")).toBeTruthy();
    });
  });
});

describe("確認メールの再送", () => {
  it("成功すると非断定形の文言で結果を伝える（resendは未送達でも200を返すため）", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
    resend.mockResolvedValue({ data: {}, error: null });
    renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());

    // 直後は60秒クールダウンで押せない
    const btn = screen.getByRole("button", { name: /確認メールを再送する|秒/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("ログイン失敗経由（unconfirmed）はクールダウン無しで即座に押せる", async () => {
    signInWithPassword.mockResolvedValue({
      data: {}, error: Object.assign(new Error("Email not confirmed"), { code: "email_not_confirmed" }),
    });
    resend.mockResolvedValue({ data: {}, error: null });
    renderAuth();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() => expect(screen.getByText("メールアドレスの確認が済んでいません")).toBeTruthy());

    const btn = screen.getByRole("button", { name: "確認メールを再送する" });
    expect(btn).toHaveProperty("disabled", false);

    fireEvent.click(btn);
    await waitFor(() => {
      expect(resend).toHaveBeenCalledWith(
        expect.objectContaining({ type: "signup", email: EMAIL }),
      );
    });
  });

  it("レート制限に当たったら秒数付きの案内を出し、その秒数だけ再びロックする", async () => {
    signInWithPassword.mockResolvedValue({
      data: {}, error: Object.assign(new Error("Email not confirmed"), { code: "email_not_confirmed" }),
    });
    resend.mockResolvedValue({
      data: {},
      error: Object.assign(
        new Error("For security purposes, you can only request this after 42 seconds."),
        { code: "over_email_send_rate_limit" },
      ),
    });
    renderAuth();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() => expect(screen.getByText("メールアドレスの確認が済んでいません")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /42秒/ })).toBeTruthy();
    });
  });
});

describe("別ロールで登録し直そうとしたとき（ロール固定バグの案内）", () => {
  it("お客様として送信済みのメールで、続けてジムオーナー登録すると案内を出し signUp を呼ばない", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
    renderAuth();
    await submitSignup(); // お客様タブ・EMAIL で送信 → ローカルに記録される
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());
    signUp.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "ログインへ戻る" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy());

    await submitTrainerSignup(EMAIL);

    await waitFor(() => {
      expect(screen.getByText("別の種別で登録手続き中です")).toBeTruthy();
    });
    expect(screen.getByText(/お客様として登録手続き中/)).toBeTruthy();
    // gotrue は未確認ユーザーの再 signUp では metadata を更新しないので、
    // 無駄打ち（＝レート制限を消費するだけ）を避けるために呼ばないのが正しい。
    expect(signUp).not.toHaveBeenCalled();
  });

  it("同じロールでの再送信は通常どおり signUp を呼ぶ", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
    renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());
    signUp.mockClear();
    signUp.mockResolvedValue(newUnconfirmedUser());

    fireEvent.click(screen.getByRole("button", { name: "ログインへ戻る" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy());
    await submitSignup(EMAIL); // 同じお客様タブ

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
  });

  it("ログイン成功時は記録をクリアする（次回以降の誤検知を防ぐ）", async () => {
    signUp.mockResolvedValue(newUnconfirmedUser());
    renderAuth();
    await submitSignup();
    await waitFor(() => expect(screen.getByText("確認メールを送信しました")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "ログインへ戻る" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy());

    signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "abcdef12" } });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled());
    expect(localStorage.getItem("gymboard_pending_signup")).toBeNull();
  });
});

describe("確認リンクの処理に失敗したとき（AuthCallback からの ?error=）", () => {
  it("otp_expired は期限切れの案内を出す", async () => {
    renderAuth("/auth?error=otp_expired");
    await waitFor(() => {
      expect(
        screen.getByText("確認リンクの有効期限が切れているか、すでに使用済みです。下のフォームでログインをお試しください。"),
      ).toBeTruthy();
    });
  });

  it("その他のコードは汎用の案内を出す（生のエラー文字列を描画しない）", async () => {
    renderAuth("/auth?error=weird_unknown_code");
    await waitFor(() => {
      expect(screen.getByText("確認リンクを処理できませんでした。お手数ですが、もう一度お試しください。")).toBeTruthy();
    });
    expect(screen.queryByText("weird_unknown_code")).toBeNull();
  });

  it("閉じるボタンで消せる", async () => {
    renderAuth("/auth?error=otp_expired");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("閉じる"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("翻訳キーの5言語そろい（fallbackLng が ja なので欠けると日本語が出る）", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const authOf = (l: string) =>
    JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).auth as Record<string, string>;

  const NEW_KEYS = [
    "signupSentTitle", "signupSentNext", "signupSentNative",
    "linkErrorExpired", "linkErrorGeneric", "errRateLimitSeconds",
    "unconfirmedTitle", "unconfirmedBody",
    "alreadyRegisteredTitle", "alreadyRegisteredHint", "toForgotFromSent",
    "resendButton", "resendCooldown", "resendSending", "resendDone", "resendFailed",
    "roleMismatchTitle", "roleMismatchBody",
  ];

  it("パネルで使うキーが全言語にある", () => {
    for (const key of [...NEW_KEYS, "forgotSentNote", "backToLogin", "labelEmail"]) {
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
    for (const key of NEW_KEYS) {
      const ja = authOf("ja")[key];
      for (const l of LANGS.filter((x) => x !== "ja")) {
        expect(authOf(l)[key], `${l}.json の auth.${key} が未翻訳`).not.toBe(ja);
      }
    }
  });
});
