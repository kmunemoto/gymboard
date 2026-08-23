import "@testing-library/jest-dom";

// テスト中の表示言語を日本語に固定する。
// jsdom の navigator.language は "en-US" のため、何もしないと i18n の言語検出が en を選び、
// @/lib/i18n が「保存言語を後から読み込んで再適用する」処理（非同期）を走らせる。
// この再適用がテストの実行中に割り込むと、同じテストが実行タイミングで日本語だったり
// 英語だったりして不安定になる。import より前に ja を入れておけば再適用自体が起きない。
// 起動時のロケール復元そのものを検証する i18nStartup.test.ts は、テスト内で明示的に
// 上書きしてから動的 import しているため影響しない。
localStorage.setItem("i18nextLng", "ja");

// jsdom は window.scrollTo を実装していない（呼ぶと Not implemented のエラーログが出る）。
// 設定画面のカテゴリー遷移や予約画面がスクロール制御に使うため、無害な実装を入れておく。
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
