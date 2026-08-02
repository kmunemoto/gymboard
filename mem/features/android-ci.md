# Android を iOS と同じく GitHub 管理にする（2026-08-02）

## 背景・方針

これまで iOS は `.github/workflows/ios-build.yml`（`workflow_dispatch`）で
GitHub Actions のmacOSランナー上でビルド・署名・App Store Connectへのアップロードまで
完結している。Android は逆に、`scripts/build-android.bat` でWeb側のビルドと
Gradle設定の同期まではWindows上で自動化してあるものの、そこから先
（署名付きAABの生成・Play Consoleへのアップロード）は Android Studio の
「Generate Signed App Bundle」ウィザードでの手作業だった。

**方針転換: Android もiOSと同じくGitHub Actions（`workflow_dispatch`）でビルド・署名・
Play Consoleへのアップロードまで完結させる。** Windows + Android Studio は
実機での動作確認・デバッグ用途に残るが、**公式リリースの経路としては使わない**方向にする。

下流の兄弟アプリ（セッコツボード・ストレッチボード・ピラボード）も同じ方針に揃えること
（`mem/ops/vertical-fork.md` に追記済み）。特にピラボードは現時点でこの経路が
無い状態の代表例。

## 新しいワークフロー: `.github/workflows/android-build.yml`

iOSと同じ `workflow_dispatch` 手動トリガー。`ubuntu-latest` で完結する
（AndroidビルドはmacOS不要。iOSより安く速い）。

トリガー時の入力は `track` の1つだけ:
- `track` … `internal` / `alpha` / `beta` / `production`。既定は `internal`

### バージョン表記（`versionName`）はワークフローに直書きする（2026-08-02）

**当初は `workflow_dispatch` の入力にしていたが、やめた。**
`android/` は `.gitignore` 済みなので、入力にすると**現在のバージョンがリポジトリの
どこからも読めない**。「Androidのバージョンを1つ上げて」と言われても、
Play Console か Windows の `android/app/build.gradle` を見るまで**上げようがない**
（実際にそうなって作業が止まった）。iOS は `ios-build.yml` に `MARKETING_VERSION` が
直書きしてあるので「バージョンを上げた」がコミットとして履歴に残る。
**Androidも同じ形に揃えた。**

上げ方は `android-build.yml` の `ANDROID_VERSION_NAME` を書き換えるだけ。

#### 手作業時代の実績（リポジトリに記録が無かったので残す）

| 項目 | 2026-08-02 時点の Play Console 実績 |
|---|---|
| `versionCode` | **81** |
| `versionName` | **9.0** |

`ANDROID_VERSION_CODE_BASE` を 10000 にしてあるのは、この 81 を確実に上回るため
（初回CIリリースは `10000 + 1 = 10001` になる）。

#### ⚠️ iOS とは別の版数線。統一するなら 9.x 側に上げる形になる

一度は「iOS と1本に統一する」方針にしかけたが、**実際の値を確認して取りやめた。**

| | 現在 |
|---|---|
| iOS（`MARKETING_VERSION`） | `1.4.5` |
| Android（`ANDROID_VERSION_NAME`） | **`9.1`**（9.0 の次） |

**Android の方が数字が大きい。** iOS の 1.4.x に寄せると Android のお客様には
`9.0` → `1.4.6` と**バージョンが戻って見える**。`versionName` は Play では単なる
表示文字列で順序を検査されないため、**下げても弾かれずにそのまま出てしまう。**
（App Store の `MARKETING_VERSION` は増加を要求されるので、iOS 側は事故が起きない。
Android だけがノーガード＝テストで見張るしかない）

将来どうしても揃えたいなら、**iOS を 9.x 側へ上げる**（`1.4.5` → `9.x` は増加なので
App Store も通る）。ただし一度上げたら二度と下げられないので、必要になるまでやらない。

`src/test/prepareAndroidRelease.test.ts` が見張るのは:
- iOS・Android とも `versionName` が**直書きのまま**であること（入力に戻すと現在値が読めなくなる）
- Android の `versionName` が**リリース実績（9.0）より下がっていない**こと

### `versionCode` は手作業時代の地雷を構造的に無くした

`android/` は `.gitignore` 済みで、CIは毎回 `npx cap add android` から作り直す
（＝前回の `versionCode` が見えない）。そこで **iOSの `CURRENT_PROJECT_VERSION` と
同じ発想で `github.run_number` を使う**（ワークフロー実行のたびに単調増加する
GitHub側のカウンタ）。

これにより、`capacitor-8-upgrade.md` の「やってはいけないこと」にあった
**「`android/` を作り直すと `versionCode` が1に戻り、Play Consoleに
`Version code 1 has already been used` で弾かれる」という地雷が、
設計上起こらなくなった。** 手作業のように「バージョンコードを忘れずに+1する」
という注意事項そのものが要らない。

#### ⚠️ `run_number` だけでは足りなかった（2026-08-02 修正）

上の設計には穴があった。**`github.run_number` は「そのワークフローの実行回数」なので
初回実行では 1 になる。** `android-build.yml` は新規追加のワークフローで実行回数0
（`ios-build.yml` が115回まで積み上がっているのとは違う）。一方 Play Console には
Android Studio で手作業アップロードしてきたAABが既に載っている。

つまり**初回のCIリリースは、置き換えたはずの
`Version code 1 has already been used` を経路を変えて踏み直す。**
しかも落ちるのは「10分かけてビルドし終えた最後のアップロード段」で、
CI（`ci.yml`）では絶対に検知できない。

対策として `ANDROID_VERSION_CODE_BASE`（現在 `10000`）で下駄を履かせ、
`versionCode = BASE + run_number` にした。手で +1 しながら運用してきた番号が
10000 に達することは実質ないので、初回から確実に上回る。
下駄を足しても `run_number` は単調増加のままなので、上の性質は失われない。

**もし初回アップロードでこのエラーが出たら**、Play Console に上がっている最大の
`versionCode` より大きくなるよう `android-build.yml` の `ANDROID_VERSION_CODE_BASE`
を上げること（`versionCode` は一度上げたら下げられないので、上げる方向は常に安全）。

回帰テストは `src/test/prepareAndroidRelease.test.ts`。スクリプト側の計算だけでなく、
**`android-build.yml` が実際に `ANDROID_VERSION_CODE_BASE` を渡しているか**も
YAMLを読んで検査している（配線が外れると上記のとおりCIでは検知できないため）。

### 署名: `scripts/prepare-android-release.mjs`（新規）

`scripts/patch-android.mjs` とは別スクリプトにした。`patch-android.mjs` は
「`versionCode`/`versionName` を書き換えない」ことを `src/test/patchAndroid.test.ts` が
明示的に守っている（Windows側の手作業を壊さないための不変条件）。ここに
バージョン更新と署名を混ぜると、その不変条件が読みにくくなるため分離した。

- 環境変数が無ければ何もしない（ローカルで誤って実行しても無害）
- `ANDROID_VERSION_CODE` / `ANDROID_VERSION_NAME` … `android/app/build.gradle` の
  該当行を書き換える
- `ANDROID_VERSION_CODE_BASE`（省略可・既定0）… `ANDROID_VERSION_CODE` に足す下駄。
  上の「`run_number` だけでは足りなかった」参照。上限 2100000000 を超えたら止める
- `ANDROID_KEYSTORE_PATH` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
  `ANDROID_KEY_PASSWORD` … `signingConfigs.release` ブロックを配線し、
  `buildTypes.release` に適用する（Android Studioのウィザードが対話的にやることを
  非対話のCI向けに `build.gradle` へ書き下したもの）
- 冪等。`src/test/prepareAndroidRelease.test.ts` で検証済み

### Play Consoleへのアップロードは「公開」しない

`r0adkll/upload-google-play@v1`（サードパーティだがこの用途で広く使われている
実績のあるアクション）で `status: draft` かつ既定トラック `internal` にしてある。
**iOSの App Store Connect アップロードが自動で審査提出・公開まではしないのと
同じ安全側の既定**で、Play Console側で人間が明示的に確認して公開するまで
実際のユーザーには届かない。信頼できるようになったら `track` を `production` に
変えて呼び出せばよい（ワークフローYAML自体の編集は不要）。

## 必要な GitHub Secrets（このリポジトリで4種・新規追加）

| Secret | 内容 | 取得方法 |
|---|---|---|
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` をbase64化したもの | Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("google-services.json")) \| Set-Clipboard` でクリップボードにコピーしてSecretへ貼り付け |
| `ANDROID_KEYSTORE_BASE64` | リリース署名用キーストア（.jks/.keystore）をbase64化したもの | 同上のコマンドをキーストアファイルに対して実行。**Android Studioの署名ウィザードで今まさに使っているファイルと同じもの** |
| `ANDROID_KEYSTORE_PASSWORD` | ストアのパスワード | 署名ウィザードで毎回入力している値と同じ |
| `ANDROID_KEY_ALIAS` | キーのエイリアス名 | 同上 |
| `ANDROID_KEY_PASSWORD` | キーのパスワード | 同上 |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play Console API用サービスアカウントのJSON鍵（**新規に作る**。生のJSON文字列をそのまま貼る、base64化しない） | 下記手順 |

`GOOGLE_SERVICES_JSON_BASE64` 以外はiOS側の `APPLE_TEAM_ID` / `IOS_P12_BASE64` 等と
同じ考え方（証明書・鍵の類）。**⚠️ これらはCLAUDE.mdの「秘密情報（サービスアカウントJSON、
署名鍵など）はコミットしない」に該当する。リポジトリに直接書かず、必ずGitHub Secretsに登録すること。**

### `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` の作り方（初回のみ）

1. Play Console → 該当アプリ → 設定 → API アクセス
2. 「新しいサービス アカウントを作成」→ Google Cloud Console に飛ぶのでそこで作成
   （プロジェクトが未リンクなら先にリンクする）
3. 作成したサービスアカウントの「鍵」タブ → 鍵を追加 → JSON → ダウンロード
4. Play Console に戻り、そのサービスアカウントを「ユーザーを招待」から追加し、
   `app.gymboard.mobile` に対して「リリースの管理」権限を付与
5. ダウンロードしたJSONファイルの中身をそのまま `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
   Secretに貼る（base64化は不要。`r0adkll/upload-google-play` が生JSON文字列を期待する）

## Windows + Android Studio の扱い

**残す。** 実機での動作確認・デバッグ用途（プッシュ通知・バッジ・スプラッシュ等の
実機検証）には引き続き必要。`scripts/build-android.bat` / `scripts/patch-android.mjs`
もそのまま使える。**変わるのは「公式リリースの経路」だけ**で、
署名付きAABを手で作ってPlay Consoleにアップロードする作業はこのワークフローに置き換わる。

## 下流の兄弟アプリへの展開

`mem/ops/vertical-fork.md`「ブランド差し替えチェックリスト」に、iOSの
bundle ID / Firebase設定と並べて Android CI のセットアップを追記した。
各アプリで必要なもの:

- 独自の `google-services.json`（Firebaseプロジェクトを分ける。iOS側の地雷5-bと同じ注意）
- 独自の署名キーストア（**アプリごとに新規生成する。GymBoardのキーストアを使い回さない**。
  Play Storeの署名は原則変更不可なので、最初から各アプリ専用のものを用意すること）
- 独自のPlay Console サービスアカウント（Play Consoleのアプリごとに権限が分かれるため）
- `android-build.yml` 内の `packageName: app.gymboard.mobile` を各アプリの
  `appId`（`capacitor.config.ts`）に合わせて書き換える

## 検証状況（正直なところ）

このクラウドセッションはネイティブビルドを実行できないため
（CLAUDE.mdの前提）、**このワークフロー自体をこのセッションから実行して
グリーンを確認することはできていない。** 検証できたのは:

- YAML構文が正しいこと
- `scripts/prepare-android-release.mjs` の文字列パッチ処理が期待どおり動くこと
  （モックの `build.gradle` に対する単体テスト16件。冪等性の検証で実際に1件、
  「再実行時に誤って失敗と判定するバグ」を発見・修正済み）
- 既存の `patch-android.mjs` との責務分離・非干渉

**その後、机上の再点検で実際にバグを1件見つけた**（上の「`run_number` だけでは
足りなかった」）。`versionCode` が初回 1 になる問題で、走らせていたら初回で落ちていた。
**「テストがグリーン」はこのワークフローが通ることを何も保証しない**という実例。

**Secrets を登録したうえで、一度 `workflow_dispatch` で実際に走らせて
グリーンになることを確認すること。** 初回は `track: internal` のまま実行し、
Play Console側で内部テストトラックにAABが上がることを確認してから
本番トラックへの利用を検討する。
