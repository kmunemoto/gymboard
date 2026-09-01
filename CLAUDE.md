# GymBoard（Claude Code 用メモ）

## 概要
マルチテナントのジム管理アプリ。React + TypeScript + Capacitor（iOS/Android ネイティブ）
+ Supabase（Lovable Cloud）。UI は Tailwind / shadcn/ui。

## コーディング規約
- アイコンは Lucide React のみ。絵文字は使わない。
- 既存のコンポーネントとパターンに合わせる。お客様向けUIテキストは日本語。
- 既存の挙動を壊さない。変更時はコードレビュー＋ユニット/統合/システムテストの観点を意識する。

## マルチテナントの注意
- テナントごとに挙動が変わる。特定テナント専用の変更を全テナントに適用しない。
- 自社ジム Salute御所南: tenant_id = ceda19b0-d5e0-4928-ab2e-996a0b823af4
- Supabase project ref = rrbfwitprzuevzytykrq

## ビルド/リポジトリの前提
- ios/ と GoogleService-Info.plist / google-services.json は .gitignore 済み。
  ネイティブ設定はビルド時に注入されるため、リポジトリ内に無くても正常。
- **iOS のリリースは GitHub Actions**（.github/workflows/ios-build.yml、workflow_dispatch）。
  バージョンは同ファイルの MARKETING_VERSION を書き換える。
- **Android のリリースは Windows + Android Studio で手作業**（2026-08-03 に現状維持と決定）。
  `scripts\build-android.bat` → Android Studio で署名付きAAB → Play Console へアップロード。
  🔴 **版数（versionCode / versionName）はリポジトリで管理しない**（2026-08-13 にそう決めた）。
  `android/app/build.gradle` を **Android Studio で直接編集する**。
  以前あった `android-version.json` / `scripts/set-android-version.mjs` は削除済み。
  **したがってセッションから現在の版数は読めない。聞かれても推測で答えないこと。**
  `build-android.bat` は最後に build.gradle の現在値を表示するだけ（書き換えない）。
  **アップロード前に必ず Play Console の実物を確認する**（そこが唯一の正）。
  リリースしたら `mem/features/android-ci.md` の「リリース実績」に記録すること。
- `.github/workflows/android-build.yml` は作ってあるが**使っていない**
  （Secrets 6種の準備コストが見合わないため見送り。workflow_dispatch なので放置しても動かない）。
  再開するときの手順は mem/features/android-ci.md。
  クラウドセッションではネイティブビルドを実行・検証できない。
- Lovable と GitHub 同期しているプロジェクト。変更はブランチで行い PR を作る（main を直接壊さない）。

## 検証は CI と同じコマンドで行う
push する前に、`.github/workflows/ci.yml` と**同じコマンド**を回すこと。

```bash
npx tsc --noEmit -p tsconfig.app.json   # ← -p を付けないと別設定になり、型エラーを見逃す
npm test
npm run build
```

### 🔴 `npm test` は**終了コード**で見る。要約行を grep しない（2026-08-12）

vitest は「テストは全部通ったが、テスト中に**未処理の例外**が出た」場合、
こう出して **exit 1** で終わる:

```
 Test Files  88 passed (88)
      Tests  1115 passed (1115)
     Errors  6 errors        ← ここ
```

`Tests` 行だけ見ると**完全に緑に見える**。実際に2回だまされた
（1回目は「再現しない謎のフレーク」として流してしまい、2回目に CI で落ちて判明）。

よくある原因は **React の effect の中で投げる例外**（テストの supabase モックに
メソッドが足りない等）。テスト自体は通るので `it()` は緑のまま。

```bash
npm test; echo "exit=$?"     # ← これで見る
```

**`npx tsc --noEmit`（`-p` 無し）で代用しない。** 2026-08-03 に実際に踏んだ:
手元では0件だったのに CI で TS2339 が5件出た。ゲートはこの3つで、
`npx eslint .` は `continue-on-error: true` の参考表示（既存の指摘が多数あり、
新規の指摘だけ見ればよい）。

`npm run build` は **`supabase/functions/mcp/index.ts` を再生成する**。
この成果物を手で直しても build で巻き戻るので、直すなら生成元の `src/lib/mcp/`。

## リリース完了は「リリースノート書いて」で知る（2026-08-05）
ストアへの提出は宗本さんが手で行い、**セッションからは確認する手段が無い**
（iOS は Actions がアップロードまで、審査・公開は人の操作。Android は Windows +
Android Studio の手作業）。そのため、**「リリースノート書いて」＝そこまでの
バージョンはリリース済み、という合図**にする取り決めになっている。
「リリースしましたか？」と聞き返さないこと。言われたら、文章を書く前に:

```
1. リリース実績の記録（mem/features/android-ci.md）に、いま出ていた版を書く
2. iOS 側のバージョン表記（ios-build.yml の MARKETING_VERSION）を更新する
3. そのうえで新しい版のリリースノートを書く
```

**Android の版数はここでは上げない**（2026-08-13 以降）。リポジトリに版数を持っていないので、
`android/app/build.gradle` を Android Studio で直接上げる＝宗本さんの手元の作業になる。
セッションからは現在値が読めないため、**Android の版数を書いたり推測したりしないこと。**

iOS は同じ版数を使い回せない。同じ版のノートを直したいだけ（内容の訂正等）と
判断できるときは上げない。迷ったら上げる方を選ぶ（余分に上げても無害）。
アップロード直前には必ず Play Console / App Store Connect の実物を確認すること
（この取り決めは実態と自動同期しない）。詳細は `mem/ops/release-signal.md`。

### 🔴 修正はためない（2026-08-09）
**不具合の修正をマージしたら、そのままビルドに載せるところまで持っていく。**
マージ＝出荷ではない。ネイティブは Actions を回すまで、お客様の端末には1行も届かない。

2026-08-09 に実際に起きたこと: ソーシャルログインが戻ってこない不具合を直して
main にマージしたが、**iOS の最後のビルドは前日 8/8 23:11 の #121 のまま**だった。
出回っている版は「Apple / Google のボタンは出るのに押すと戻れない」ままで、
`git log` を見ても気づけない（マージ済みなので直ったように見える）。

なので、**ユーザーに影響する修正をマージしたら毎回**:

```
1. iOS の最後のビルドがどのコミットか確認する
   mcp__github__actions_list（ios-build.yml）の head_sha を見る。
   ⚠️ 出力が大きいので、python で workflow_runs を絞って読むこと
2. 修正がそのビルドに入っていないなら、**入っていないと明示して伝える**
   「直しました」で終わらせない。お客様にはまだ届いていない
3. ビルドを回すかどうかを確認する（App Store Connect へのアップロードなので勝手に回さない）
```

リリースノートでも、**不具合修正は機能追加より先に書く**（読む人が知りたいのは
「自分が踏んだ問題が直ったか」のほう）。

## Lovable / Supabase は自分で繋いでやる（2026-08-06）
**手順書を書いて渡さない。接続してできる作業は最後まで自分でやり、結果を報告する。**

- 自分でやる: 本番DBの調査、本番への SQL 適用、適用後の検証、publish 後の動作確認
- 手順書を渡す: ストア提出、Xcode / Android Studio、Apple・Firebase の管理画面、
  実機での決済・通知の確認、Stripe ダッシュボード

接続の詰まりどころ:
- **Lovable Cloud のプロジェクトは Supabase コネクタから見えない**ことがある
  （コネクタが別アカウント → `permission denied`）。**Lovable の `query_database`** を使う。
  `project_id` は Supabase の ref ではなく **Lovable のプロジェクトID**
  （ジムボード = `69ac2641-45d8-44e0-b60d-4e002a4f9c1c`）。
- **コンテナから `*.supabase.co` へ直接 curl はできない**（プロキシが CONNECT を 403）。
  REST で確かめたくなったら、代わりに SQL 上でロールを演じる。

### 🔴 Edge Function は push でも Publish でも本番に出ない（2026-08-12）

**新しい Edge Function を本番に出す経路は「Lovable のエージェントに頼む」だけ。**
GitHub にマージしても、Lovable が同期しても、宗本さんが Publish しても出ない
（`read_file` で見るとファイルは在る。動いていないだけ）。

```
mcp__Lovable__send_message(… "supabase/functions/<名前> をデプロイしてください。
                               コードは既にリポジトリにあります。編集は不要です。")
```

**そのあと必ず自分で叩いて確かめる。404 なら未デプロイ、それ以外ならデプロイ済み。**
コンテナから `*.supabase.co` へ curl はできないので DB から `net.http_post`。
**デプロイ済みと分かっている関数を1本、対照として同時に叩くこと。**

`.github/workflows/deploy-functions.yml` は**削除した**。18回すべて skipped の
まま success で、しかもジムボードの Supabase は Lovable Cloud の持ち物なので
`SUPABASE_ACCESS_TOKEN` を発行する手段が無い。直しようがなかった。
詳細と手順は `mem/ops/edge-function-deploy.md`。

**本番を触るときは必ず3段構え。**「読み取りで現状を出す → 実行する →
**そのロールを演じて**実際に読む・呼ぶ」。`has_function_privilege` が期待どおりでも
足りない。2026-08-06 に3を怠って本番の全画面を落とした（`mem/ops/tenant-boundary.md`）。

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<user_id>','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;   -- 未ログインを見るなら SET LOCAL ROLE anon;
SELECT count(*) FROM public.<よく読むテーブル>;
ROLLBACK;                        -- SET LOCAL なので必ず元に戻る
```

## PR の運用
🔴 **PR の作成からマージまで、毎回の指示を待たずに自分で最後まで行う**（2026-09-01 に
宗本さんが「これ毎回、指示されなくても」と明言）。作業が終わったら:

```
1. ゲート4つを通す（tsc app / tsc strict / npm test / npm run build）
2. PR を作る（このリポジトリに PR テンプレートは無い）
3. GitHub の CI が緑になるのを待つ（verify と e2e の2ジョブ）
4. squash-merge する
5. ブランチを main へ再同期する
   git fetch origin main && git reset --hard origin/main
   git push -u origin <branch> --force-with-lease
```

- 落ちたら直してグリーンにしてからマージする。
- 「マージしますか？」と聞き返さない。**聞くのは、作るものの中身が分かれるときだけ。**
- ⚠️ セッションの既定は「頼まれない限り PR を作らない」。この取り決めがそれを上書きする。
  次のセッションでも同じように動くこと。
- マージしただけでは**お客様の端末には1行も届かない**。ネイティブに関わる修正は
  「修正はためない」（上記）に従い、iOS のビルドに載っているかまで確認する。

## セキュリティ
- 秘密情報（サービスアカウントJSON、署名鍵など）はコミットしない。
- **このリポジトリは public。** 「社内だから」で書けるものは何も無い。
- 🔴 **Lovable への依頼文（`send_message`）に秘密情報を書かない。**
  Lovable は**依頼文をそのままコミットメッセージにして push する**。
  2026-08-08 に Apple のクライアントシークレット（JWT）をこれで公開してしまい、
  鍵ごとローテーションする羽目になった（`mem/auth/social-login.md`）。
  **コミットメッセージは `.gitignore` できないし、squash-merge 運用では
  履歴の書き換えも現実的でない。** 出てしまったら失効させるしかない。
  秘密情報の設定は「宗本さんが画面に直接貼る」に回すこと。手順だけ渡す。
- `.env` は**追跡されているが、これは正常**。中身は `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PUBLISHABLE_KEY`（anon キー）の3つだけで、
  いずれもクライアントのバンドルに埋め込まれる公開前提の値。
  **`.gitignore` に足さないこと**（Lovable のビルドが壊れる）。
  ただし `service_role` キーだけは絶対にここに置かない。RLS を全部素通りする。

## 業種特化の兄弟アプリ（セッコツボード等）について
**2026-08-03 に、上流・下流の運用（兄弟が `git merge upstream/main` で追従する仕組み）は
終了しました。** 以後、各アプリはそれぞれ独立して進みます。
このリポジトリを「上流」として扱う必要はなく、`upstream-changelog.md` への追記も不要です。
コード（`featureFlags.ts` / `brand.ts` / `vertical.ja.json` / `test/helpers/upstream.ts`）は
そのまま残してあります。経緯は `mem/ops/vertical-fork.md` の冒頭。

## 参照
- 機能・実装メモ: `mem/`（例: `mem/auth/session-management.md`, `mem/features/workout-share.md`）
- セットアップ・スクリプト・環境変数: `README.md`
- 一時的な表示切替フラグ: `src/lib/featureFlags.ts`
