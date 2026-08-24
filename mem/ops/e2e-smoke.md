# 主要導線の E2E（第1段: fixtures モードのUIスモーク）2026-08-24

`e2e/trainer-smoke.spec.ts`。`npm run test:e2e`。CI の `e2e` ジョブで毎PR回る。

## なぜ要ったか

ユニットテストは88ファイル1115本あるが、**その多くはソースを文字列で検査する
「配線の番人」**（`readFileSync` して正規表現で見る形）。これは逆流防止には効くが、
**ブラウザで実際に描画されるかは誰も見ていなかった**。

捕まえたいのはこの3つ:

- 真っ白（描画されない）
- JS の例外でその画面だけ機能しない
- メニューを押しても切り替わらない

いずれも `git log` を見ても、ユニットテストが緑でも、気づけない。

## なぜ fixtures モードなのか

本物の Supabase は Lovable Cloud の**本番プロジェクト1つしか無い**。ステージングが無い。
本番に E2E を当てると他店のデータを触りうるし、クラウドのセッションからは
`*.supabase.co` へ直接繋げない（プロキシが CONNECT を弾く）。

そこで `vite --mode fixtures`（`VITE_DEV_FIXTURES=true`）で回す。Supabase クライアントが
`src/dev/fixtureClient.ts` に差し替わり、ログインもネットワークも無しで全画面が描ける。

⚠️ **この E2E が見るのは UI の導線だけ。** RLS・DBの制約・Edge Function は
fixtures では再現されない。バックエンド込みは、テスト用テナントを分離できてから（第2段）。

## 🔴 文言で判定しない

5言語 i18n で、兄弟アプリは語彙をオーバーレイする
（`src/test/forkHostileTests.test.ts` が「リテラルで断言するな」を強制している）。

最初に英語ラベルを直書きして**5本落とした。画面は正しく動いていた**。
メニューが "Customers" なのに見出しは "Clients" だっただけ。
文言で判定すると、**動いているものを落とすテスト**になる。

判定はロール・構造・アイコンで行う。画面の特定に使えるもの:

- `getByRole("complementary")` … デスクトップのサイドバー
- `getByRole("navigation")` … お客様側の下部ナビ
- **`svg.lucide-users`** … Lucide は svg に `lucide-<アイコン名>` を付ける。
  `TrainerSidebar` の `{ id: "clients", icon: Users }` と同じだけ安定していて、言語に依存しない
- `.card-hover.cursor-pointer` … 顧客一覧の1行（`TrainerClientList` の `renderRow`）

言語は `localStorage.i18nextLng = "ja"` で固定する（検出順は localStorage → navigator
なので、固定しないとランナーのロケール次第で表示言語が変わる）。

## 踏んだ落とし穴

### 1. `goto` の直後に body を読むと必ず空

React の起動＋認証状態の解決＋lazy チャンクの取得が終わるまで中身が無い。
`gotoApp()` が「中身が50文字を超えるまで」ポーリングする。

### 2. 🔴「押したら前と変わる」では判定できない

ナビの**最初の1回はすでに開いている画面**（ホーム）。正しく動いていても中身は変わらない。
これで3本落とした。

見るべきは「**項目の数だけ違う画面がある**」ほう。
`new Set(seen).size === count` で見る。押しても切り替わらなければ指紋が重複して数が足りない。

### 3. h1 が無い画面が実在する

カウンセリング画面には第1レベルの見出しが無い。「全画面に h1 を付けろ」は
テストの都合でアプリを変えることになるので採らず、`contentSignature()`
（main の本文先頭400文字）で見る形にした。

※ カウンセリング画面に h1 が無いのはアクセシビリティ上の不揃いではある。直していない。

### 4. 30秒では足りない

サイドメニューは10画面ある。1つずつ開いて描画を待つと既定の枠に収まらないので、
全体を60秒、この1本だけ `test.setTimeout(120_000)` にしてある。

## 変異テスト（この E2E が本当に落ちるか）

| 変異 | 落ちた本 | メッセージ |
|---|---|---|
| サイドバーの `onClick` を空にする | サイドメニュー巡回 | メニュー10個に対して、開いた画面は1種類しかありません |
| 顧客カードの `onClick` を空にする | カルテを開ける | 顧客を押してもカルテが開きません |
| `TrainerSchedule` の描画で例外を投げる | サイドメニュー巡回 | メニュー巡回で例外が出ている |

3つとも赤くなることを確認済み。

## ブラウザの置き場所

- 開発コンテナ: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` にプリインストール済み。
  **`npx playwright install` は実行しない**（環境の指示）。@playwright/test が期待する
  リビジョンとズレるので、`executablePath` で実体を直接指す
- GitHub Actions: そのパスは無い。`playwright.config.ts` が `existsSync` で判定して
  `executablePath` を渡さず、`npx playwright install chromium` が置いた実体に任せる
- 別の環境: `PW_CHROMIUM_PATH` で上書きできる

IPv6 バインドが使えない環境があるので、dev サーバーは `--host 127.0.0.1` で立てている
（`vite.config.ts` の host は `"::"`）。
